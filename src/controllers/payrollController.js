const pool = require('../config/db');
const { getSettings } = require('./settingsController');

const getWorkingDays = (year, month) => {
  let count = 0;
  const days = new Date(year, month, 0).getDate();
  for (let d = 1; d <= days; d++) {
    const day = new Date(year, month - 1, d).getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
};

const fmtPayroll = (p) => {
  if (!p) return null;
  return {
    _id: p.id, id: p.id,
    employee: p.employee_id
      ? { _id: p.employee_id, id: p.employee_id, firstName: p.first_name, lastName: p.last_name, employeeCode: p.employee_code, designation: p.designation }
      : p.employee_id,
    month: p.month, year: p.year, period: p.period,
    baseSalary: parseFloat(p.base_salary) || 0, overtimePay: parseFloat(p.overtime_pay) || 0,
    bonus: parseFloat(p.bonus) || 0,
    allowances: { hra: parseFloat(p.allowance_hra) || 0, transport: parseFloat(p.allowance_transport) || 0, medical: parseFloat(p.allowance_medical) || 0, other: parseFloat(p.allowance_other) || 0 },
    grossSalary: parseFloat(p.gross_salary) || 0,
    deductions: { tax: parseFloat(p.tax) || 0, providentFund: parseFloat(p.provident_fund) || 0, insurance: parseFloat(p.insurance) || 0, lateDeduction: parseFloat(p.late_deduction) || 0, loanRepayment: parseFloat(p.loan_repayment) || 0, other: parseFloat(p.deduction_other) || 0 },
    totalDeductions: parseFloat(p.total_deductions) || 0, netSalary: parseFloat(p.net_salary) || 0,
    workingDays: p.working_days, presentDays: p.present_days, absentDays: p.absent_days,
    leaveDays: p.leave_days, overtimeHours: parseFloat(p.overtime_hours) || 0, lateMinutes: p.late_minutes || 0,
    status: p.status, paymentDate: p.payment_date, paymentMethod: p.payment_method, notes: p.notes,
    createdAt: p.created_at,
  };
};

const paySelect = `p.*, e.first_name, e.last_name, e.employee_code, e.designation FROM payroll p LEFT JOIN employees e ON e.id=p.employee_id`;

const computePayroll = async (employeeId, month, year) => {
  const [empRes, settings] = await Promise.all([
    pool.query('SELECT * FROM employees WHERE id=$1', [employeeId]),
    getSettings(),
  ]);
  const emp = empRes.rows[0];
  if (!emp) throw new Error('Employee not found');

  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = new Date(year, month, 0).toISOString().split('T')[0];
  const attRes = await pool.query(
    `SELECT status, late_minutes, overtime_minutes FROM attendance WHERE employee_id=$1 AND date>=$2 AND date<=$3`,
    [employeeId, start, end]
  );
  const records = attRes.rows;

  // ── Attendance counts ──────────────────────────────────────────────────────
  const workingDays = getWorkingDays(year, month);
  const presentDays = records.filter((r) => ['present', 'late'].includes(r.status)).length;
  const halfDays = records.filter((r) => r.status === 'half_day').length;
  const absentDays = records.filter((r) => r.status === 'absent').length;
  const leaveDays = records.filter((r) => r.status === 'on_leave').length;
  const lateCount = records.filter((r) => r.status === 'late').length;
  const totalLateMinutes = records.reduce((s, r) => s + (r.late_minutes || 0), 0);
  const overtimeMinutes = records.reduce((s, r) => s + (r.overtime_minutes || 0), 0);

  // ── Settings values with defaults ─────────────────────────────────────────
  const otMultiplier = parseFloat(settings.overtime_multiplier) || 1.5;
  const hraPercent = parseFloat(settings.hra_percent) || 10;
  const transportAllowance = parseFloat(settings.transport_allowance) || 1500;
  const medicalAllowance = parseFloat(settings.medical_allowance) || 1000;
  const pfPercent = parseFloat(settings.pf_percent) || 12;
  const taxPercent = parseFloat(settings.tax_percent) || 10;
  const taxThreshold = parseFloat(settings.tax_threshold) || 50000;
  const lateCountForHalfDay = parseInt(settings.late_count_for_half_day) || 3;

  // ── Salary calculation ─────────────────────────────────────────────────────
  // Effective days: present + half_days×0.5 + paid leaves
  const effectiveDays = presentDays + halfDays * 0.5 + leaveDays;
  const perDaySalary = parseFloat(emp.base_salary) / (workingDays || 1);
  const basePay = perDaySalary * effectiveDays;
  const hourlyRate = parseFloat(emp.hourly_rate) || (parseFloat(emp.base_salary) / (workingDays * 8));

  // Late penalty: every N lates = 0.5 day deduction
  const latePenaltyDays = Math.floor(lateCount / lateCountForHalfDay) * 0.5;
  const latePenaltyAmount = perDaySalary * latePenaltyDays;
  // Per-minute deduction on remaining lates (those not yet grouped into half-day penalty)
  const remainingLateCount = lateCount % lateCountForHalfDay;
  const remainingLateMinutes = remainingLateCount > 0
    ? records.filter((r) => r.status === 'late')
        .sort((a, b) => (a.late_minutes || 0) - (b.late_minutes || 0))
        .slice(0, remainingLateCount)
        .reduce((s, r) => s + (r.late_minutes || 0), 0)
    : 0;
  const lateDeduction = latePenaltyAmount + (remainingLateMinutes / 60) * hourlyRate;

  const overtimePay = (overtimeMinutes / 60) * hourlyRate * otMultiplier;
  const hraAllowance = parseFloat(emp.base_salary) * hraPercent / 100;

  const grossSalary = basePay + overtimePay + hraAllowance + transportAllowance + medicalAllowance;
  const providentFund = basePay * pfPercent / 100;
  const tax = basePay > taxThreshold ? basePay * taxPercent / 100 : 0;
  const totalDeductions = providentFund + tax + lateDeduction;
  const netSalary = Math.max(0, grossSalary - totalDeductions);
  const period = `${year}-${String(month).padStart(2, '0')}`;

  return {
    employee_id: employeeId, month, year, period,
    base_salary: Math.round(basePay), overtime_pay: Math.round(overtimePay),
    allowance_hra: Math.round(hraAllowance), allowance_transport: Math.round(transportAllowance), allowance_medical: Math.round(medicalAllowance),
    gross_salary: Math.round(grossSalary), tax: Math.round(tax),
    provident_fund: Math.round(providentFund), late_deduction: Math.round(lateDeduction),
    total_deductions: Math.round(totalDeductions), net_salary: Math.round(netSalary),
    working_days: workingDays, present_days: presentDays, absent_days: absentDays,
    leave_days: leaveDays, overtime_hours: Math.round(overtimeMinutes / 60 * 100) / 100, late_minutes: totalLateMinutes,
  };
};

exports.preview = async (req, res) => {
  try {
    const { employeeId, month, year } = req.query;
    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year) || new Date().getFullYear();
    const data = await computePayroll(employeeId, m, y);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.generate = async (req, res) => {
  try {
    const { employeeIds, month, year } = req.body;
    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year) || new Date().getFullYear();

    let targets = employeeIds?.length ? employeeIds : [];
    if (!targets.length) {
      const r = await pool.query(`SELECT id FROM employees WHERE status='active'`);
      targets = r.rows.map((e) => e.id);
    }

    const results = [];
    for (const empId of targets) {
      try {
        const data = await computePayroll(empId, m, y);
        const keys = Object.keys(data);
        const vals = Object.values(data);
        const setClauses = keys.map((k, i) => `${k}=$${i + 1}`).join(',');
        const cols = keys.join(',');
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(',');
        vals.push(req.user.id);
        const r = await pool.query(
          `INSERT INTO payroll (${cols},generated_by,status) VALUES (${placeholders},$${vals.length},'draft')
           ON CONFLICT (employee_id,month,year) DO UPDATE SET ${setClauses},generated_by=$${vals.length},updated_at=NOW()
           RETURNING *`,
          vals
        );
        results.push(fmtPayroll(r.rows[0]));
      } catch (e) {
        results.push({ employeeId: empId, error: e.message });
      }
    }
    res.status(201).json({ success: true, data: results, count: results.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getAll = async (req, res) => {
  try {
    const { month, year, status, employeeId, page = 1, limit = 20 } = req.query;
    const conditions = []; const params = [];
    if (month) { params.push(+month); conditions.push(`p.month=$${params.length}`); }
    if (year) { params.push(+year); conditions.push(`p.year=$${params.length}`); }
    if (status) { params.push(status); conditions.push(`p.status=$${params.length}`); }
    if (employeeId) { params.push(employeeId); conditions.push(`p.employee_id=$${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const [rows, countRow] = await Promise.all([
      pool.query(`SELECT ${paySelect} ${where} ORDER BY p.year DESC, p.month DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]),
      pool.query(`SELECT COUNT(*) FROM payroll p ${where}`, params),
    ]);
    const total = parseInt(countRow.rows[0].count);
    res.json({ success: true, data: rows.rows.map(fmtPayroll), pagination: { total, page: +page, limit: +limit, pages: Math.ceil(total / limit) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const r = await pool.query(`SELECT ${paySelect} WHERE p.id=$1`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Payroll not found' });
    res.json({ success: true, data: fmtPayroll(r.rows[0]) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const { status, paymentDate, paymentMethod, notes } = req.body;
    const r = await pool.query(
      `UPDATE payroll SET status=$1,payment_date=$2,payment_method=$3,notes=$4,approved_by=$5,updated_at=NOW() WHERE id=$6 RETURNING *`,
      [status, paymentDate || null, paymentMethod || null, notes || null, req.user.id, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Payroll not found' });
    res.json({ success: true, data: fmtPayroll(r.rows[0]) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getSummary = async (req, res) => {
  try {
    const { month, year } = req.query;
    const conditions = []; const params = [];
    if (month) { params.push(+month); conditions.push(`month=$${params.length}`); }
    if (year) { params.push(+year); conditions.push(`year=$${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT SUM(gross_salary) AS "totalGross", SUM(net_salary) AS "totalNet", SUM(total_deductions) AS "totalDeductions", COUNT(*) AS count FROM payroll ${where}`,
      params
    );
    const row = r.rows[0];
    res.json({ success: true, data: { totalGross: parseFloat(row.totalGross) || 0, totalNet: parseFloat(row.totalNet) || 0, totalDeductions: parseFloat(row.totalDeductions) || 0, count: parseInt(row.count) || 0 } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
