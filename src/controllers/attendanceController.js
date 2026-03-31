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
    isLocked: r.is_locked || false,
    editedBy: r.edited_by_name || null,
    editedAt: r.edited_at || null,
    editReason: r.edit_reason || null,
  };
};

// Determine attendance status from late minutes using company settings
// getSettings() returns camelCase keys — support both for safety
const resolveStatus = (lateMinutes, settings) => {
  const grace     = settings.gracePeriodMinutes    ?? settings.grace_period_minutes    ?? 15;
  const halfDayAt = settings.halfDayAfterMinutes   ?? settings.half_day_after_minutes  ?? 240;
  const absentAt  = settings.absentAfterMinutes    ?? settings.absent_after_minutes    ?? 480;

  if (lateMinutes <= grace)     return 'present';
  if (lateMinutes <= halfDayAt) return 'late';
  if (lateMinutes <= absentAt)  return 'half_day';
  return 'absent';
};

exports.checkIn = async (req, res) => {
  try {
    const { employeeId, notes } = req.body;
    const empRes = await pool.query('SELECT work_start_time FROM employees WHERE id=$1', [employeeId]);
    if (!empRes.rows[0]) return res.status(404).json({ success: false, message: 'Employee not found' });

    const settings = await getSettings();
    const tz = settings.timezone || 'Asia/Kolkata';

    // Use company timezone for date + late calculation
    const now = new Date();
    const today = new Date(now.toLocaleString('en-US', { timeZone: tz }))
      .toLocaleDateString('en-CA'); // YYYY-MM-DD in company timezone

    // Block regular check-in when face recognition is enforced globally
    if (settings.face_recognition_enabled)
      return res.status(403).json({
        success: false,
        message: 'Face recognition attendance is enabled. Please use Face Check-in to mark your attendance.',
        code: 'FACE_REQUIRED',
      });

    const existing = await pool.query('SELECT check_in FROM attendance WHERE employee_id=$1 AND date=$2', [employeeId, today]);
    if (existing.rows[0]?.check_in)
      return res.status(409).json({ success: false, message: 'Already checked in today' });

    // Compare times in company timezone (not UTC)
    const nowInTZ = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    const [h, m] = empRes.rows[0].work_start_time.split(':').map(Number);
    const scheduledInTZ = new Date(nowInTZ); scheduledInTZ.setHours(h, m, 0, 0);
    const lateMinutes = Math.max(0, Math.round((nowInTZ - scheduledInTZ) / 60000));
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
    const settings = await getSettings();
    const tz = settings.timezone || 'Asia/Kolkata';
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: tz }))
      .toLocaleDateString('en-CA');
    // Block regular check-out when face recognition is enforced globally
    if (settings.face_recognition_enabled)
      return res.status(403).json({
        success: false,
        message: 'Face recognition attendance is enabled. Please use Face Check-out to mark your attendance.',
        code: 'FACE_REQUIRED',
      });

    const att = await pool.query('SELECT * FROM attendance WHERE employee_id=$1 AND date=$2', [employeeId, today]);
    if (!att.rows[0] || !att.rows[0].check_in)
      return res.status(400).json({ success: false, message: 'No check-in found for today' });
    if (att.rows[0].check_out)
      return res.status(409).json({ success: false, message: 'Already checked out' });

    const workHoursPerDay = 8; // standard full day
    const now = new Date();
    const workHours = (now - new Date(att.rows[0].check_in)) / 3600000;
    const overtimeMinutes = workHours > workHoursPerDay
      ? Math.round((workHours - workHoursPerDay) * 60)
      : 0;

    const r = await pool.query(
      `UPDATE attendance SET check_out=$1, work_hours=$2, overtime_minutes=$3, is_locked=true, updated_at=NOW()
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
    const settings = await getSettings();
    const tz = settings.timezone || 'Asia/Kolkata';
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: tz })).toLocaleDateString('en-CA');
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
      absent:  records.filter((r) => r.status === 'absent').length,
      // status is the single source of truth — 'present' means arrived within grace period
      late:    records.filter((r) => r.status === 'late').length,
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
    const settings = await getSettings();
    const tz = settings.timezone || 'Asia/Kolkata';
    const targetDate = date || new Date(new Date().toLocaleString('en-US', { timeZone: tz })).toLocaleDateString('en-CA');
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

// ── ATTENDANCE CORRECTION ─────────────────────────────────────────────────────

// GET /attendance/all?date=&from=&to=&employeeId=&departmentId=&status=&month=&year=
exports.getAllAttendance = async (req, res) => {
  try {
    const { date, from, to, employeeId, departmentId, status, month, year } = req.query;
    let whereClauses = [];
    let params = [];
    let idx = 1;

    // Date filtering — supports: single date, from/to range, or month/year
    if (date) {
      whereClauses.push(`a.date = $${idx++}`);
      params.push(date);
    } else if (from && to) {
      whereClauses.push(`a.date >= $${idx++} AND a.date <= $${idx++}`);
      params.push(from, to);
    } else if (from) {
      whereClauses.push(`a.date >= $${idx++}`);
      params.push(from);
    } else if (month && year) {
      const start = `${year}-${String(month).padStart(2, '0')}-01`;
      const end = new Date(year, month, 0).toISOString().split('T')[0];
      whereClauses.push(`a.date >= $${idx++} AND a.date <= $${idx++}`);
      params.push(start, end);
    }
    if (employeeId) {
      whereClauses.push(`a.employee_id = $${idx++}`);
      params.push(employeeId);
    }
    if (departmentId) {
      whereClauses.push(`e.department_id = $${idx++}`);
      params.push(departmentId);
    }
    if (status) {
      whereClauses.push(`a.status = $${idx++}`);
      params.push(status);
    }

    const where = whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : '';
    const r = await pool.query(
      `SELECT a.*, e.first_name, e.last_name, e.employee_code, e.designation, e.department_id,
              d.name AS department_name,
              u.name AS edited_by_name
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN users u ON u.id = a.edited_by
       ${where}
       ORDER BY a.date DESC, a.check_in DESC NULLS LAST`,
      params
    );
    res.json({ success: true, data: r.rows.map(fmtAtt) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /attendance/:id/correct  — admin edits any field
exports.correctAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const { checkIn, checkOut, status, notes, editReason } = req.body;
    const adminUserId = req.user.id;

    if (!editReason?.trim())
      return res.status(400).json({ success: false, message: 'Edit reason is required' });

    // Recalculate work hours if both times provided
    let workHours = null;
    let overtimeMinutes = null;
    if (checkIn && checkOut) {
      const diff = (new Date(checkOut) - new Date(checkIn)) / 3600000;
      workHours = Math.max(0, Math.round(diff * 100) / 100);
      overtimeMinutes = workHours > 8 ? Math.round((workHours - 8) * 60) : 0;
    }

    // Recalculate late_minutes if checkIn is being corrected
    let lateMinutes = null;
    if (checkIn) {
      const attRow = await pool.query(
        `SELECT e.work_start_time FROM attendance a JOIN employees e ON e.id=a.employee_id WHERE a.id=$1`,
        [id]
      );
      if (attRow.rows[0]?.work_start_time) {
        const settingsForTZ = await getSettings();
        const tzForCorr = settingsForTZ.timezone || 'Asia/Kolkata';
        const checkInDate = new Date(checkIn);
        const checkInInTZ = new Date(checkInDate.toLocaleString('en-US', { timeZone: tzForCorr }));
        const [h, m] = attRow.rows[0].work_start_time.split(':').map(Number);
        const scheduledInTZ = new Date(checkInInTZ); scheduledInTZ.setHours(h, m, 0, 0);
        lateMinutes = Math.max(0, Math.round((checkInInTZ - scheduledInTZ) / 60000));
      }
    }

    const fields = [];
    const vals = [];
    let p = 1;

    if (checkIn !== undefined)      { fields.push(`check_in=$${p++}`);           vals.push(checkIn || null); }
    if (checkOut !== undefined)     { fields.push(`check_out=$${p++}`);          vals.push(checkOut || null); }
    if (status)                     { fields.push(`status=$${p++}`);             vals.push(status); }
    if (notes !== undefined)        { fields.push(`notes=$${p++}`);              vals.push(notes || null); }
    if (workHours !== null)         { fields.push(`work_hours=$${p++}`);         vals.push(workHours); }
    if (overtimeMinutes !== null)   { fields.push(`overtime_minutes=$${p++}`);   vals.push(overtimeMinutes); }
    if (lateMinutes !== null)       { fields.push(`late_minutes=$${p++}`);       vals.push(lateMinutes); }

    fields.push(`edited_by=$${p++}`, `edited_at=NOW()`, `edit_reason=$${p++}`, `is_locked=true`, `updated_at=NOW()`);
    vals.push(adminUserId, editReason.trim());

    const r = await pool.query(
      `UPDATE attendance SET ${fields.join(', ')} WHERE id=$${p} RETURNING *`,
      [...vals, id]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Attendance record not found' });
    res.json({ success: true, data: fmtAtt(r.rows[0]), message: 'Attendance corrected successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /attendance/recalculate — fix late_minutes + status for all records on a date using pure SQL AT TIME ZONE
exports.recalculate = async (req, res) => {
  try {
    const settings = await getSettings();
    const tz = settings.timezone || 'Asia/Kolkata';
    const grace     = settings.gracePeriodMinutes    ?? settings.grace_period_minutes    ?? 15;
    const halfDayAt = settings.halfDayAfterMinutes   ?? settings.half_day_after_minutes  ?? 240;
    const absentAt  = settings.absentAfterMinutes    ?? settings.absent_after_minutes    ?? 480;
    const { date } = req.body;

    // Compute today's date in the company timezone entirely in SQL
    const todayRes = await pool.query(`SELECT (NOW() AT TIME ZONE $1)::date::text AS today`, [tz]);
    const targetDate = date || todayRes.rows[0].today;

    // Pure SQL: convert check_in from UTC → company TZ, then diff against work_start_time on the same date
    const r = await pool.query(
      `WITH recalc AS (
        SELECT
          a.id,
          GREATEST(0, ROUND(
            EXTRACT(EPOCH FROM (
              (a.check_in AT TIME ZONE 'UTC') AT TIME ZONE $2
              - ($1::date + e.work_start_time::time)
            )) / 60
          ))::INTEGER AS late_min
        FROM attendance a
        JOIN employees e ON e.id = a.employee_id
        WHERE a.date = $1 AND a.check_in IS NOT NULL
      )
      UPDATE attendance a
      SET
        late_minutes = recalc.late_min,
        status = CASE
          WHEN recalc.late_min <= $3 THEN 'present'
          WHEN recalc.late_min <= $4 THEN 'late'
          WHEN recalc.late_min <= $5 THEN 'half_day'
          ELSE 'absent'
        END,
        updated_at = NOW()
      FROM recalc
      WHERE a.id = recalc.id`,
      [targetDate, tz, grace, halfDayAt, absentAt]
    );

    res.json({ success: true, message: `Recalculated ${r.rowCount} records for ${targetDate}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /attendance/:id/unlock  — admin re-opens a checked-out day
exports.unlockAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const { editReason } = req.body;
    const adminUserId = req.user.id;

    if (!editReason?.trim())
      return res.status(400).json({ success: false, message: 'Reason is required to unlock attendance' });

    const r = await pool.query(
      `UPDATE attendance
       SET check_out=NULL, work_hours=0, overtime_minutes=0,
           is_locked=false, edited_by=$1, edited_at=NOW(), edit_reason=$2, updated_at=NOW()
       WHERE id=$3 RETURNING *`,
      [adminUserId, editReason.trim(), id]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Attendance record not found' });
    res.json({ success: true, data: fmtAtt(r.rows[0]), message: 'Attendance unlocked. Employee can check in again.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
