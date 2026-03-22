const Payroll = require('../models/Payroll');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');

const getWorkingDays = (year, month) => {
  let count = 0;
  const days = new Date(year, month, 0).getDate();
  for (let d = 1; d <= days; d++) {
    const day = new Date(year, month - 1, d).getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
};

const computePayroll = async (employeeId, month, year) => {
  const employee = await Employee.findById(employeeId);
  if (!employee) throw new Error('Employee not found');

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59);
  const records = await Attendance.find({ employee: employeeId, date: { $gte: start, $lte: end } });

  const workingDays = getWorkingDays(year, month);
  const presentDays = records.filter((r) => ['present', 'late'].includes(r.status)).length;
  const halfDays = records.filter((r) => r.status === 'half_day').length;
  const absentDays = records.filter((r) => r.status === 'absent').length;
  const leaveDays = records.filter((r) => r.status === 'on_leave').length;
  const totalLateMinutes = records.reduce((s, r) => s + (r.lateMinutes || 0), 0);
  const overtimeMinutes = records.reduce((s, r) => s + (r.overtimeMinutes || 0), 0);

  const effectiveDays = presentDays + halfDays * 0.5 + leaveDays;
  const perDaySalary = employee.baseSalary / workingDays;
  const basePay = perDaySalary * effectiveDays;

  const lateDeduction = (totalLateMinutes / 60) * (employee.hourlyRate || employee.baseSalary / (workingDays * 8));
  const overtimePay = (overtimeMinutes / 60) * (employee.hourlyRate || 0) * 1.5;

  const providentFund = basePay * 0.12;
  const tax = basePay > 50000 ? basePay * 0.1 : 0;

  return {
    employee: employeeId,
    month, year,
    baseSalary: Math.round(basePay),
    overtimePay: Math.round(overtimePay),
    workingDays, presentDays, absentDays, leaveDays,
    overtimeHours: Math.round(overtimeMinutes / 60 * 100) / 100,
    lateMinutes: totalLateMinutes,
    allowances: {
      hra: Math.round(employee.baseSalary * 0.1),
      transport: 1500,
      medical: 1000,
    },
    deductions: {
      providentFund: Math.round(providentFund),
      tax: Math.round(tax),
      lateDeduction: Math.round(lateDeduction),
    },
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

    const targets = employeeIds?.length
      ? employeeIds
      : (await Employee.find({ status: 'active' }).select('_id')).map((e) => e._id);

    const results = [];
    for (const empId of targets) {
      try {
        const data = await computePayroll(empId, m, y);
        const payroll = await Payroll.findOneAndUpdate(
          { employee: empId, month: m, year: y },
          { ...data, generatedBy: req.user._id, status: 'draft' },
          { upsert: true, new: true }
        );
        results.push(payroll);
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
    const filter = {};
    if (month) filter.month = +month;
    if (year) filter.year = +year;
    if (status) filter.status = status;
    if (employeeId) filter.employee = employeeId;

    const skip = (page - 1) * limit;
    const [payrolls, total] = await Promise.all([
      Payroll.find(filter)
        .populate('employee', 'firstName lastName employeeCode designation department')
        .skip(skip)
        .limit(+limit)
        .sort({ year: -1, month: -1 }),
      Payroll.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: payrolls,
      pagination: { total, page: +page, limit: +limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const payroll = await Payroll.findById(req.params.id)
      .populate('employee', 'firstName lastName employeeCode designation department bankAccount')
      .populate('generatedBy', 'name')
      .populate('approvedBy', 'name');
    if (!payroll) return res.status(404).json({ success: false, message: 'Payroll not found' });
    res.json({ success: true, data: payroll });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const { status, paymentDate, paymentMethod, notes } = req.body;
    const payroll = await Payroll.findByIdAndUpdate(
      req.params.id,
      { status, paymentDate, paymentMethod, notes, approvedBy: req.user._id },
      { new: true }
    );
    if (!payroll) return res.status(404).json({ success: false, message: 'Payroll not found' });
    res.json({ success: true, data: payroll });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getSummary = async (req, res) => {
  try {
    const { month, year } = req.query;
    const filter = {};
    if (month) filter.month = +month;
    if (year) filter.year = +year;

    const agg = await Payroll.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalGross: { $sum: '$grossSalary' },
          totalNet: { $sum: '$netSalary' },
          totalDeductions: { $sum: '$totalDeductions' },
          count: { $sum: 1 },
        },
      },
    ]);

    res.json({ success: true, data: agg[0] || {} });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
