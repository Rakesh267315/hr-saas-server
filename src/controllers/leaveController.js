const pool = require('../config/db');
const { eachDayOfInterval, isWeekend, isValid, parseISO } = require('date-fns');
const { createNotification } = require('./notificationController');
const { getSettings } = require('./settingsController');

// Day-name → JS getDay() index
const DAY_NUM = { Sunday:0, Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6 };

// Count working days between two dates, skipping Saturday + company weekly off day
const countWorkdays = (start, end, weeklyOffDay = 'Sunday') => {
  const offDayNum = DAY_NUM[weeklyOffDay] ?? 0;
  return eachDayOfInterval({ start, end }).filter((d) => {
    const day = d.getDay();
    return day !== 6 && day !== offDayNum; // skip Saturday + configured off day
  }).length;
};

const fmtLeave = (l) => ({
  _id: l.id, id: l.id,
  employee: l.employee_id ? {
    _id: l.employee_id, id: l.employee_id,
    firstName: l.first_name, lastName: l.last_name, employeeCode: l.employee_code,
    department: l.department_id,
  } : l.employee_id,
  leaveType: l.leave_type, startDate: l.start_date, endDate: l.end_date,
  totalDays: parseFloat(l.total_days), reason: l.reason, status: l.status,
  approvedBy: l.approved_by_name ? { _id: l.approved_by, name: l.approved_by_name } : null,
  approvedAt: l.approved_at, rejectionReason: l.rejection_reason, isHalfDay: l.is_half_day,
  createdAt: l.created_at,
});

const leaveSelect = `
  l.*, e.first_name, e.last_name, e.employee_code, e.department_id,
  u.name AS approved_by_name FROM leaves l
  LEFT JOIN employees e ON e.id=l.employee_id
  LEFT JOIN users u ON u.id=l.approved_by
`;

const VALID_LEAVE_TYPES = ['annual', 'sick', 'casual', 'maternity', 'unpaid', 'CL', 'SL'];

// ── Monthly Leave Policy (CL = Casual, SL = Sick) ─────────────────────────────
// Defaults — overridden by company_settings at runtime
const MONTHLY_POLICY_DEFAULTS = {
  CL: { maxCarryForward: 6, label: 'Casual Leave' },
  SL: { maxCarryForward: 6, label: 'Sick Leave' },
};

// Read live limits from company_settings (falls back to defaults)
const getMonthlyPolicy = async () => {
  const s = await getSettings();
  return {
    CL: { defaultPerMonth: s.casual_leave_limit ?? 2, maxCarryForward: 6, label: 'Casual Leave' },
    SL: { defaultPerMonth: s.sick_leave_limit   ?? 1, maxCarryForward: 6, label: 'Sick Leave'   },
  };
};

/**
 * Compute monthly leave balance for CL + SL.
 * Priority: admin override > default + carry-forward
 * used_leaves = only APPROVED leaves (pending shown separately, does not block remaining)
 * @param {string} employeeId
 * @param {string} month  - format YYYY-MM
 */
const computeMonthlyBalance = async (employeeId, month) => {
  const [year, mon] = month.split('-').map(Number);
  const monthStart  = `${month}-01`;
  const lastDay     = new Date(year, mon, 0).getDate();
  const monthEnd    = `${month}-${String(lastDay).padStart(2, '0')}`;
  const MONTHLY_POLICY = await getMonthlyPolicy();
  const result = {};

  for (const [type, policy] of Object.entries(MONTHLY_POLICY)) {
    // ── 1. Check admin / manager override for this employee + month ──────────
    const overrideRes = await pool.query(
      `SELECT custom_total_leaves, notes FROM leave_overrides
       WHERE employee_id=$1 AND month=$2 AND leave_type=$3`,
      [employeeId, month, type]
    );
    const hasOverride  = overrideRes.rows.length > 0;
    const customTotal  = hasOverride ? parseFloat(overrideRes.rows[0].custom_total_leaves) : null;

    // ── 2. Count approved + pending separately (for display) ─────────────────
    const usedRes = await pool.query(
      `SELECT
         COALESCE(SUM(total_days) FILTER (WHERE status='approved'), 0) AS approved_days,
         COALESCE(SUM(total_days) FILTER (WHERE status='pending'),  0) AS pending_days
       FROM leaves
       WHERE employee_id=$1 AND leave_type=$2
         AND status IN ('pending','approved')
         AND start_date >= $3 AND start_date <= $4`,
      [employeeId, type, monthStart, monthEnd]
    );
    const approvedDays = parseFloat(usedRes.rows[0].approved_days);
    const pendingDays  = parseFloat(usedRes.rows[0].pending_days);
    // used = only approved (pending does NOT deduct remaining)
    const usedLeaves   = approvedDays;

    // ── 3. Compute total based on override or default + carry-forward ─────────
    let carryForward = 0;
    let totalLeaves;

    if (hasOverride) {
      // Override takes full priority — carry-forward is irrelevant
      totalLeaves  = customTotal;
      carryForward = 0;
    } else {
      // Normal path: default + carry-forward from previous month
      const prevDate  = new Date(year, mon - 2, 1);
      const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

      const storedRes = await pool.query(
        `SELECT remaining_leaves FROM leave_monthly_balances
         WHERE employee_id=$1 AND month=$2 AND leave_type=$3`,
        [employeeId, prevMonth, type]
      );
      if (storedRes.rows[0]) {
        carryForward = Math.min(parseFloat(storedRes.rows[0].remaining_leaves), policy.maxCarryForward);
      } else {
        // Bootstrap previous month on-the-fly (1 level, no recursion)
        // Also respect any override that existed for prev month
        const [pY, pM] = prevMonth.split('-').map(Number);
        const pStart   = `${prevMonth}-01`;
        const pEnd     = `${prevMonth}-${String(new Date(pY, pM, 0).getDate()).padStart(2, '0')}`;

        const [prevUsedRes, prevOverrideRes] = await Promise.all([
          pool.query(
            `SELECT COALESCE(SUM(total_days) FILTER (WHERE status='approved'), 0) AS used
             FROM leaves WHERE employee_id=$1 AND leave_type=$2 AND start_date >= $3 AND start_date <= $4`,
            [employeeId, type, pStart, pEnd]
          ),
          pool.query(
            `SELECT custom_total_leaves FROM leave_overrides
             WHERE employee_id=$1 AND month=$2 AND leave_type=$3`,
            [employeeId, prevMonth, type]
          ),
        ]);
        const prevUsed    = parseFloat(prevUsedRes.rows[0].used);
        // If prev month had an override, use that as the total; otherwise use default
        const prevTotal   = prevOverrideRes.rows[0]
          ? parseFloat(prevOverrideRes.rows[0].custom_total_leaves)
          : policy.defaultPerMonth;
        const prevRemaining = Math.max(0, prevTotal - prevUsed);
        carryForward        = Math.min(prevRemaining, policy.maxCarryForward);
      }
      totalLeaves = policy.defaultPerMonth + carryForward;
    }

    // ── 4. Remaining = total - used (approved only), capped at 0 ─────────────
    const remainingLeaves = Math.max(0, totalLeaves - usedLeaves);

    // ── 5. Upsert cache ───────────────────────────────────────────────────────
    await pool.query(
      `INSERT INTO leave_monthly_balances
         (employee_id,month,leave_type,default_leaves,carry_forward,total_leaves,used_leaves,remaining_leaves)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (employee_id,month,leave_type) DO UPDATE SET
         default_leaves=$4, carry_forward=$5, total_leaves=$6,
         used_leaves=$7, remaining_leaves=$8, updated_at=NOW()`,
      [employeeId, month, type, hasOverride ? 0 : policy.defaultPerMonth, carryForward, totalLeaves, usedLeaves, remainingLeaves]
    );

    result[type] = {
      type, label: policy.label,
      defaultLeaves: hasOverride ? 0 : policy.defaultPerMonth,
      carryForward,
      totalLeaves,
      usedLeaves,          // approved only
      approvedLeaves: approvedDays,
      pendingLeaves:  pendingDays,
      remainingLeaves,
      isOverridden: hasOverride,
      overrideNotes: hasOverride ? overrideRes.rows[0].notes : null,
    };
  }
  return result;
};

exports.apply = async (req, res) => {
  try {
    const { employeeId, leaveType, startDate, endDate, reason, isHalfDay } = req.body;

    // ── Input validation ───────────────────────────────────────────────────
    if (!employeeId) return res.status(400).json({ success: false, message: 'Employee ID required' });
    if (!VALID_LEAVE_TYPES.includes(leaveType))
      return res.status(400).json({ success: false, message: `Invalid leave type. Must be one of: ${VALID_LEAVE_TYPES.join(', ')}` });
    if (!startDate || !endDate)
      return res.status(400).json({ success: false, message: 'Start date and end date are required' });

    const start = parseISO(startDate);
    const end = parseISO(endDate);
    if (!isValid(start) || !isValid(end))
      return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD' });
    if (start > end)
      return res.status(400).json({ success: false, message: 'Start date cannot be after end date' });

    // ── No retroactive leaves (past dates not allowed for new applications) ──
    const settings = await getSettings();
    const tz = settings.timezone || 'Asia/Kolkata';
    const todayStr = new Date(new Date().toLocaleString('en-US', { timeZone: tz })).toLocaleDateString('en-CA');
    if (startDate < todayStr)
      return res.status(400).json({ success: false, message: `Cannot apply leave for past dates. Earliest allowed: ${todayStr}` });

    const empRes = await pool.query(
      `SELECT leave_annual,leave_sick,leave_casual,leave_maternity,leave_unpaid FROM employees WHERE id=$1`,
      [employeeId]
    );
    if (!empRes.rows[0]) return res.status(404).json({ success: false, message: 'Employee not found' });

    // ── Overlap check — no duplicate leaves for same period ────────────────
    const overlapRes = await pool.query(
      `SELECT id FROM leaves
       WHERE employee_id=$1 AND status NOT IN ('cancelled','rejected')
         AND start_date <= $3 AND end_date >= $2`,
      [employeeId, startDate, endDate]
    );
    if (overlapRes.rows.length > 0)
      return res.status(409).json({ success: false, message: 'A leave request already exists for this date range' });

    const totalDays = isHalfDay ? 0.5 : countWorkdays(start, end, settings.weekly_off_day || 'Sunday');
    if (totalDays <= 0)
      return res.status(400).json({ success: false, message: 'Selected dates have no working days' });

    // ── Balance check: legacy types use employee columns; CL/SL use monthly policy ──
    if (['CL', 'SL'].includes(leaveType)) {
      const leaveMonth = startDate.slice(0, 7); // YYYY-MM
      const monthlyBal = await computeMonthlyBalance(employeeId, leaveMonth);
      const avail = monthlyBal[leaveType]?.remainingLeaves ?? 0;
      if (avail < totalDays)
        return res.status(400).json({
          success: false,
          message: `Insufficient ${leaveType} balance for ${leaveMonth}. Available: ${avail} day(s), Required: ${totalDays}`,
        });
    } else {
      const balanceMap = { annual: 'leave_annual', sick: 'leave_sick', casual: 'leave_casual', maternity: 'leave_maternity', unpaid: 'leave_unpaid' };
      const balanceCol = balanceMap[leaveType];
      if (balanceCol) {
        const balance = parseFloat(empRes.rows[0][balanceCol]);
        if (balance < totalDays)
          return res.status(400).json({ success: false, message: `Insufficient ${leaveType} leave balance. Available: ${balance} days, Required: ${totalDays} days` });
      }
    }

    const r = await pool.query(
      `INSERT INTO leaves (employee_id,leave_type,start_date,end_date,total_days,reason,is_half_day)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [employeeId, leaveType, startDate, endDate, totalDays, reason?.trim() || null, isHalfDay || false]
    );
    const full = await pool.query(`SELECT ${leaveSelect} WHERE l.id=$1`, [r.rows[0].id]);

    // Notify all admins + HR about new leave request
    try {
      const admins = await pool.query(
        `SELECT id FROM users WHERE role IN ('admin','hr','super_admin') AND is_active=true`
      );
      const emp = full.rows[0];
      await createNotification(admins.rows.map((u) => u.id), {
        type: 'leave_request',
        title: 'New Leave Request',
        message: `${emp.first_name} ${emp.last_name || ''} applied for ${leaveType} leave (${totalDays} day${totalDays > 1 ? 's' : ''}) from ${startDate} to ${endDate}.`,
        link: '/admin/leaves',
      });
    } catch {}

    res.status(201).json({ success: true, data: fmtLeave(full.rows[0]) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getAll = async (req, res) => {
  try {
    const { status, employeeId, page = 1, limit = 20 } = req.query;
    const conditions = []; const params = [];
    if (status) { params.push(status); conditions.push(`l.status=$${params.length}`); }
    if (employeeId) { params.push(employeeId); conditions.push(`l.employee_id=$${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (Math.max(1, +page) - 1) * Math.min(100, +limit);

    const [rows, countRow] = await Promise.all([
      pool.query(`SELECT ${leaveSelect} ${where} ORDER BY l.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, Math.min(100, +limit), offset]),
      pool.query(`SELECT COUNT(*) FROM leaves l ${where}`, params),
    ]);
    const total = parseInt(countRow.rows[0].count);
    res.json({ success: true, data: rows.rows.map(fmtLeave), pagination: { total, page: +page, limit: +limit, pages: Math.ceil(total / +limit) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const r = await pool.query(`SELECT ${leaveSelect} WHERE l.id=$1`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Leave not found' });
    res.json({ success: true, data: fmtLeave(r.rows[0]) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const { status, rejectionReason } = req.body;
    const VALID_STATUSES = ['approved', 'rejected'];
    if (!VALID_STATUSES.includes(status))
      return res.status(400).json({ success: false, message: `Status must be one of: ${VALID_STATUSES.join(', ')}` });
    if (status === 'rejected' && !rejectionReason?.trim())
      return res.status(400).json({ success: false, message: 'Rejection reason is required' });

    const leaveRes = await pool.query(`SELECT ${leaveSelect} WHERE l.id=$1`, [req.params.id]);
    const leave = leaveRes.rows[0];
    if (!leave) return res.status(404).json({ success: false, message: 'Leave not found' });
    if (leave.status !== 'pending') return res.status(400).json({ success: false, message: 'Only pending leaves can be approved or rejected' });

    await pool.query(
      `UPDATE leaves SET status=$1,approved_by=$2,approved_at=NOW(),rejection_reason=$3,updated_at=NOW() WHERE id=$4`,
      [status, req.user.id, rejectionReason?.trim() || null, req.params.id]
    );

    if (status === 'approved') {
      // Deduct leave balance
      const balanceMap = { annual: 'leave_annual', sick: 'leave_sick', casual: 'leave_casual', maternity: 'leave_maternity', unpaid: 'leave_unpaid' };
      const col = balanceMap[leave.leave_type];
      if (col) await pool.query(`UPDATE employees SET ${col}=GREATEST(0,${col}-$1) WHERE id=$2`, [leave.total_days, leave.employee_id]);

      // Mark attendance as on_leave for working days in range
      const days = eachDayOfInterval({ start: new Date(leave.start_date), end: new Date(leave.end_date) })
        .filter((d) => !isWeekend(d));
      await Promise.all(days.map((day) => {
        const d = day.toISOString().split('T')[0];
        return pool.query(
          `INSERT INTO attendance (employee_id,date,status) VALUES ($1,$2,'on_leave')
           ON CONFLICT (employee_id,date) DO UPDATE SET status='on_leave', updated_at=NOW()`,
          [leave.employee_id, d]
        );
      }));
    }

    const updated = await pool.query(`SELECT ${leaveSelect} WHERE l.id=$1`, [req.params.id]);

    // Notify the employee about their leave decision
    try {
      const empUser = await pool.query(
        'SELECT user_id, first_name FROM employees WHERE id=$1', [leave.employee_id]
      );
      if (empUser.rows[0]?.user_id) {
        const label = status === 'approved' ? '✅ Approved' : '❌ Rejected';
        await createNotification(empUser.rows[0].user_id, {
          type: status === 'approved' ? 'leave_approved' : 'leave_rejected',
          title: `Leave Request ${label}`,
          message: status === 'approved'
            ? `Your ${leave.leave_type} leave (${leave.total_days} days) has been approved.`
            : `Your ${leave.leave_type} leave was rejected. Reason: ${rejectionReason}`,
          link: '/employee/leaves',
        });
      }
    } catch {}

    res.json({ success: true, data: fmtLeave(updated.rows[0]) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.cancel = async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM leaves WHERE id=$1', [req.params.id]);
    const leave = r.rows[0];
    if (!leave) return res.status(404).json({ success: false, message: 'Leave not found' });
    if (!['pending', 'approved'].includes(leave.status))
      return res.status(400).json({ success: false, message: 'Cannot cancel this leave' });

    // Restore balance if leave was approved
    if (leave.status === 'approved') {
      const balanceMap = { annual: 'leave_annual', sick: 'leave_sick', casual: 'leave_casual', maternity: 'leave_maternity', unpaid: 'leave_unpaid' };
      const col = balanceMap[leave.leave_type];
      if (col) await pool.query(`UPDATE employees SET ${col}=${col}+$1 WHERE id=$2`, [leave.total_days, leave.employee_id]);

      // Revert attendance records back to absent for future dates only
      const today = new Date().toISOString().split('T')[0];
      const days = eachDayOfInterval({ start: new Date(leave.start_date), end: new Date(leave.end_date) })
        .filter((d) => d.getDay() !== 6 && !isWeekend(d) && d.toISOString().split('T')[0] >= today);
      await Promise.all(days.map((day) => {
        const d = day.toISOString().split('T')[0];
        return pool.query(
          `UPDATE attendance SET status='absent', updated_at=NOW()
           WHERE employee_id=$1 AND date=$2 AND status='on_leave'`,
          [leave.employee_id, d]
        );
      }));
    }

    await pool.query(`UPDATE leaves SET status='cancelled', updated_at=NOW() WHERE id=$1`, [req.params.id]);
    res.json({ success: true, message: 'Leave cancelled successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /leaves/monthly-balance/:id?month=YYYY-MM
exports.getMonthlyBalance = async (req, res) => {
  try {
    const { id } = req.params;
    const currentMonth = new Date().toISOString().slice(0, 7);
    const targetMonth  = (req.query.month || currentMonth).slice(0, 7);

    if (!/^\d{4}-\d{2}$/.test(targetMonth))
      return res.status(400).json({ success: false, message: 'Invalid month format. Use YYYY-MM' });

    const empRes = await pool.query('SELECT id, first_name, last_name FROM employees WHERE id=$1', [id]);
    if (!empRes.rows[0]) return res.status(404).json({ success: false, message: 'Employee not found' });

    const balance = await computeMonthlyBalance(id, targetMonth);

    res.json({
      success: true,
      data: {
        month: targetMonth,
        employee: { id, name: `${empRes.rows[0].first_name} ${empRes.rows[0].last_name || ''}`.trim() },
        balance, // { CL: {...}, SL: {...} }
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Leave Override CRUD (admin / manager set custom quota) ────────────────────

// POST /leaves/override — set or update custom leave quota for an employee + month
exports.setOverride = async (req, res) => {
  try {
    const { employeeId, month, leaveType, customTotalLeaves, notes } = req.body;

    if (!employeeId) return res.status(400).json({ success: false, message: 'employeeId required' });
    if (!month || !/^\d{4}-\d{2}$/.test(month))
      return res.status(400).json({ success: false, message: 'month must be YYYY-MM' });
    if (!['CL', 'SL'].includes(leaveType))
      return res.status(400).json({ success: false, message: 'leaveType must be CL or SL' });
    if (customTotalLeaves === undefined || customTotalLeaves === null || isNaN(Number(customTotalLeaves)) || Number(customTotalLeaves) < 0)
      return res.status(400).json({ success: false, message: 'customTotalLeaves must be >= 0' });

    const empRes = await pool.query('SELECT id, first_name, last_name FROM employees WHERE id=$1', [employeeId]);
    if (!empRes.rows[0]) return res.status(404).json({ success: false, message: 'Employee not found' });

    const r = await pool.query(
      `INSERT INTO leave_overrides (employee_id, month, leave_type, custom_total_leaves, notes, set_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (employee_id, month, leave_type) DO UPDATE SET
         custom_total_leaves=$4, notes=$5, set_by=$6, updated_at=NOW()
       RETURNING *`,
      [employeeId, month, leaveType, Number(customTotalLeaves), notes?.trim() || null, req.user.id]
    );

    // Invalidate cached balance so next fetch recomputes
    await pool.query(
      `DELETE FROM leave_monthly_balances WHERE employee_id=$1 AND month=$2 AND leave_type=$3`,
      [employeeId, month, leaveType]
    );

    const emp = empRes.rows[0];
    res.json({
      success: true,
      message: `Override set: ${emp.first_name} ${emp.last_name || ''} — ${leaveType} for ${month} = ${customTotalLeaves} day(s)`,
      data: r.rows[0],
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /leaves/overrides?month=&employeeId= — list overrides (admin/hr)
exports.getOverrides = async (req, res) => {
  try {
    const { month, employeeId } = req.query;
    const conditions = []; const params = [];
    if (month)      { params.push(month);      conditions.push(`lo.month=$${params.length}`); }
    if (employeeId) { params.push(employeeId); conditions.push(`lo.employee_id=$${params.length}`); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const r = await pool.query(
      `SELECT lo.*,
              e.first_name, e.last_name, e.employee_code,
              u.name AS set_by_name
       FROM leave_overrides lo
       JOIN employees e ON e.id = lo.employee_id
       LEFT JOIN users u ON u.id = lo.set_by
       ${where}
       ORDER BY lo.month DESC, e.first_name`,
      params
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /leaves/override/:id — remove override
exports.deleteOverride = async (req, res) => {
  try {
    const r = await pool.query(
      'DELETE FROM leave_overrides WHERE id=$1 RETURNING employee_id, month, leave_type',
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Override not found' });

    // Invalidate cache
    const { employee_id, month, leave_type } = r.rows[0];
    await pool.query(
      'DELETE FROM leave_monthly_balances WHERE employee_id=$1 AND month=$2 AND leave_type=$3',
      [employee_id, month, leave_type]
    );

    res.json({ success: true, message: 'Override removed — balance reverts to default + carry-forward' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /leaves/admin/manual — admin manually adds leave for one or all employees (bypasses past-date check)
exports.adminAddLeave = async (req, res) => {
  try {
    const { employeeIds, leaveType, startDate, endDate, reason, isHalfDay } = req.body;

    if (!VALID_LEAVE_TYPES.includes(leaveType))
      return res.status(400).json({ success: false, message: `Invalid leave type. Must be one of: ${VALID_LEAVE_TYPES.join(', ')}` });
    if (!startDate || !endDate)
      return res.status(400).json({ success: false, message: 'Start date and end date are required' });

    const start = parseISO(startDate);
    const end   = parseISO(endDate);
    if (!isValid(start) || !isValid(end))
      return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD' });
    if (start > end)
      return res.status(400).json({ success: false, message: 'Start date cannot be after end date' });

    const settings = await getSettings();

    // Resolve employee list — 'all' or array of IDs
    let empIds = [];
    const isAll = employeeIds === 'all' || (Array.isArray(employeeIds) && employeeIds[0] === 'all');
    if (isAll) {
      const allEmps = await pool.query(`SELECT id FROM employees WHERE status='active'`);
      empIds = allEmps.rows.map((r) => r.id);
    } else {
      empIds = Array.isArray(employeeIds) ? employeeIds : [employeeIds];
    }
    if (empIds.length === 0)
      return res.status(400).json({ success: false, message: 'No employees selected' });

    // Admin override: count all calendar days (incl. weekends) so single-day entries on off-days work
    const allDays     = eachDayOfInterval({ start, end });
    const totalDays   = isHalfDay ? 0.5 : allDays.length;

    // For attendance marking we still only mark actual working days as on_leave
    const offDayNum   = DAY_NUM[settings.weekly_off_day || 'Sunday'] ?? 0;
    const workingDays = allDays.filter((d) => {
      const day = d.getDay();
      return day !== 6 && day !== offDayNum;
    });

    const created = [];
    const skipped = [];

    for (const empId of empIds) {
      try {
        // Skip if overlapping leave already exists
        const overlap = await pool.query(
          `SELECT id FROM leaves WHERE employee_id=$1 AND status NOT IN ('cancelled','rejected')
           AND start_date <= $3 AND end_date >= $2`,
          [empId, startDate, endDate]
        );
        if (overlap.rows.length > 0) {
          skipped.push({ empId, reason: 'Overlapping leave exists' });
          continue;
        }

        // Insert leave as already approved (admin override)
        const r = await pool.query(
          `INSERT INTO leaves
             (employee_id, leave_type, start_date, end_date, total_days, reason, is_half_day, status, approved_by, approved_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'approved',$8,NOW()) RETURNING id`,
          [empId, leaveType, startDate, endDate, totalDays,
           reason?.trim() || 'Admin manual entry', isHalfDay || false, req.user.id]
        );

        // Mark attendance as on_leave for working days
        await Promise.all(workingDays.map((day) => {
          const d = day.toISOString().split('T')[0];
          return pool.query(
            `INSERT INTO attendance (employee_id, date, status) VALUES ($1,$2,'on_leave')
             ON CONFLICT (employee_id, date) DO UPDATE SET status='on_leave', updated_at=NOW()`,
            [empId, d]
          );
        }));

        created.push(r.rows[0].id);
      } catch (e) {
        skipped.push({ empId, reason: e.message });
      }
    }

    res.json({
      success: true,
      message: `Created ${created.length} leave record(s)${skipped.length ? `, ${skipped.length} skipped (overlapping or error)` : ''}`,
      created: created.length,
      skipped: skipped.length,
      details: skipped,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getBalance = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT leave_annual,leave_sick,leave_casual,leave_maternity,leave_unpaid,first_name,last_name FROM employees WHERE id=$1`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Employee not found' });
    const e = r.rows[0];
    res.json({
      success: true,
      data: {
        annual: e.leave_annual, sick: e.leave_sick,
        casual: e.leave_casual, maternity: e.leave_maternity, unpaid: e.leave_unpaid,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
