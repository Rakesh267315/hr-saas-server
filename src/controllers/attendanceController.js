const pool = require('../config/db');
const { getSettings } = require('./settingsController');

const fmtAtt = (r) => {
  if (!r) return null;
  return {
    _id: r.id, id: r.id,
    employee: r.employee_id
      ? { _id: r.employee_id, id: r.employee_id, firstName: r.first_name, lastName: r.last_name, employeeCode: r.employee_code, designation: r.designation, department: r.department_id ? { _id: r.department_id, name: r.department_name } : null }
      : null,
    date: r.date, checkIn: r.check_in, checkOut: r.check_out,
    status: r.status, lateMinutes: r.late_minutes || 0,
    overtimeMinutes: r.overtime_minutes || 0, workHours: parseFloat(r.work_hours) || 0,
    notes: r.notes, createdAt: r.created_at,
  };
};

// Determine attendance status from late minutes using company settings
const resolveStatus = (lateMinutes, settings) => {
  const grace = settings.grace_period_minutes ?? 15;
  const halfDayAt = settings.half_day_after_minutes ?? 240;
  const absentAt = settings.absent_after_minutes ?? 480;

  if (lateMinutes <= grace) return 'present';
  if (lateMinutes <= halfDayAt) return 'late';
  if (lateMinutes <= absentAt) return 'half_day';
  return 'absent';
};

exports.checkIn = async (req, res) => {
  try {
    const { employeeId, notes } = req.body;
    const empRes = await pool.query('SELECT work_start_time FROM employees WHERE id=$1', [employeeId]);
    if (!empRes.rows[0]) return res.status(404).json({ success: false, message: 'Employee not found' });

    const today = new Date().toISOString().split('T')[0];
    const existing = await pool.query('SELECT check_in FROM attendance WHERE employee_id=$1 AND date=$2', [employeeId, today]);
    if (existing.rows[0]?.check_in)
      return res.status(409).json({ success: false, message: 'Already checked in today' });

    const settings = await getSettings();
    const now = new Date();
    const [h, m] = empRes.rows[0].work_start_time.split(':').map(Number);
    const scheduled = new Date(now); scheduled.setHours(h, m, 0, 0);
    const lateMinutes = Math.max(0, Math.round((now - scheduled) / 60000));
    const status = resolveStatus(lateMinutes, settings);

    const r = await pool.query(
      `INSERT INTO attendance (employee_id,date,check_in,status,late_minutes,notes)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (employee_id,date) DO UPDATE SET check_in=$3,status=$4,late_minutes=$5,notes=$6,updated_at=NOW()
       RETURNING *`,
      [employeeId, today, now, status, lateMinutes, notes || null]
    );
    res.json({ success: true, data: fmtAtt(r.rows[0]) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.checkOut = async (req, res) => {
  try {
    const { employeeId } = req.body;
    const today = new Date().toISOString().split('T')[0];
    const att = await pool.query('SELECT * FROM attendance WHERE employee_id=$1 AND date=$2', [employeeId, today]);
    if (!att.rows[0] || !att.rows[0].check_in)
      return res.status(400).json({ success: false, message: 'No check-in found for today' });
    if (att.rows[0].check_out)
      return res.status(409).json({ success: false, message: 'Already checked out' });

    const settings = await getSettings();
    const workHoursPerDay = 8; // standard full day
    const now = new Date();
    const workHours = (now - new Date(att.rows[0].check_in)) / 3600000;
    const overtimeMinutes = workHours > workHoursPerDay
      ? Math.round((workHours - workHoursPerDay) * 60)
      : 0;

    const r = await pool.query(
      `UPDATE attendance SET check_out=$1, work_hours=$2, overtime_minutes=$3, updated_at=NOW()
       WHERE employee_id=$4 AND date=$5 RETURNING *`,
      [now, workHours.toFixed(2), overtimeMinutes, employeeId, today]
    );
    res.json({ success: true, data: fmtAtt(r.rows[0]) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getByEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const { month, year } = req.query;
    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year) || new Date().getFullYear();
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const end = new Date(y, m, 0).toISOString().split('T')[0];

    const r = await pool.query(
      `SELECT * FROM attendance WHERE employee_id=$1 AND date>=$2 AND date<=$3 ORDER BY date ASC`,
      [id, start, end]
    );
    res.json({ success: true, data: r.rows.map(fmtAtt) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getSummary = async (req, res) => {
  try {
    const { id } = req.params;
    const { month, year } = req.query;
    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year) || new Date().getFullYear();
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const end = new Date(y, m, 0).toISOString().split('T')[0];

    const r = await pool.query(
      `SELECT status, late_minutes, work_hours, overtime_minutes FROM attendance WHERE employee_id=$1 AND date>=$2 AND date<=$3`,
      [id, start, end]
    );
    const summary = { present: 0, absent: 0, late: 0, halfDay: 0, onLeave: 0, totalWorkHours: 0, totalOvertimeHours: 0, totalLateMinutes: 0 };
    r.rows.forEach((rec) => {
      if (['present', 'late'].includes(rec.status)) summary.present++;
      if (rec.status === 'absent') summary.absent++;
      if (rec.status === 'late') summary.late++;
      if (rec.status === 'half_day') summary.halfDay++;
      if (rec.status === 'on_leave') summary.onLeave++;
      summary.totalWorkHours += parseFloat(rec.work_hours) || 0;
      summary.totalOvertimeHours += (rec.overtime_minutes || 0) / 60;
      summary.totalLateMinutes += rec.late_minutes || 0;
    });
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getToday = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const r = await pool.query(
      `SELECT a.*, e.first_name, e.last_name, e.employee_code, e.designation, e.department_id,
              d.name AS department_name
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       WHERE a.date=$1 ORDER BY a.check_in DESC NULLS LAST`,
      [today]
    );
    const records = r.rows.map(fmtAtt);
    const stats = {
      present: records.filter((r) => ['present', 'late'].includes(r.status)).length,
      absent: records.filter((r) => r.status === 'absent').length,
      late: records.filter((r) => r.status === 'late').length,
      onLeave: records.filter((r) => r.status === 'on_leave').length,
    };
    res.json({ success: true, data: records, stats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.markAbsent = async (req, res) => {
  try {
    const { date } = req.body;
    const targetDate = date || new Date().toISOString().split('T')[0];
    const r = await pool.query(
      `INSERT INTO attendance (employee_id, date, status)
       SELECT id, $1, 'absent' FROM employees WHERE status='active'
       AND id NOT IN (SELECT employee_id FROM attendance WHERE date=$1 AND status IN ('present','late','on_leave','half_day'))
       ON CONFLICT (employee_id, date) DO NOTHING`,
      [targetDate]
    );
    res.json({ success: true, message: `Marked ${r.rowCount} employees absent` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
