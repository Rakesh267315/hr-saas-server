const pool = require('../config/db');
const { getSettings } = require('./settingsController');

// ── Euclidean distance between two face descriptors ────────────────────────
const euclideanDistance = (d1, d2) => {
  if (!d1 || !d2 || d1.length !== d2.length) return Infinity;
  return Math.sqrt(d1.reduce((sum, val, i) => sum + Math.pow(val - d2[i], 2), 0));
};

// ── Resolve attendance status from late minutes ────────────────────────────
const resolveStatus = (lateMinutes, settings) => {
  const grace    = settings.grace_period_minutes   ?? 15;
  const halfDay  = settings.half_day_after_minutes ?? 240;
  const absentAt = settings.absent_after_minutes   ?? 480;
  if (lateMinutes <= grace)    return 'present';
  if (lateMinutes <= halfDay)  return 'late';
  if (lateMinutes <= absentAt) return 'half_day';
  return 'absent';
};

// ── POST /face/:id/register ────────────────────────────────────────────────
exports.register = async (req, res) => {
  try {
    const { id } = req.params;
    const { descriptor } = req.body;

    // Validate descriptor
    if (!Array.isArray(descriptor) || descriptor.length !== 128)
      return res.status(400).json({ success: false, message: 'Invalid face descriptor — must be exactly 128 numeric values' });
    if (!descriptor.every((v) => typeof v === 'number' && isFinite(v)))
      return res.status(400).json({ success: false, message: 'Face descriptor contains invalid values' });

    // Permission check: employees may only register their own face
    if (req.user.role === 'employee') {
      const mine = await pool.query('SELECT id FROM employees WHERE user_id=$1', [req.user.id]);
      if (!mine.rows[0] || mine.rows[0].id !== id)
        return res.status(403).json({ success: false, message: 'You can only register your own face' });
    }

    const emp = await pool.query('SELECT id, first_name FROM employees WHERE id=$1', [id]);
    if (!emp.rows[0]) return res.status(404).json({ success: false, message: 'Employee not found' });

    await pool.query(
      `UPDATE employees
         SET face_descriptor=$1::jsonb, face_registered_at=NOW(), updated_at=NOW()
       WHERE id=$2`,
      [JSON.stringify(descriptor), id]
    );

    // Audit log
    console.log(`[FACE] Registered: empId=${id} by userId=${req.user.id} at ${new Date().toISOString()}`);

    res.json({ success: true, message: `Face registered for ${emp.rows[0].first_name}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /face/:id ───────────────────────────────────────────────────────
exports.deleteFace = async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE employees
         SET face_descriptor=NULL, face_registered_at=NULL, updated_at=NOW()
       WHERE id=$1 RETURNING first_name, last_name`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Employee not found' });

    console.log(`[FACE] Deleted: empId=${req.params.id} by adminId=${req.user.id}`);

    res.json({ success: true, message: `Face data deleted for ${r.rows[0].first_name} ${r.rows[0].last_name || ''}`.trim() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /face/:id/status ───────────────────────────────────────────────────
exports.status = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT
         face_descriptor IS NOT NULL AS registered,
         face_registered_at
       FROM employees WHERE id=$1`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Employee not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /face/checkin ─────────────────────────────────────────────────────
exports.faceCheckin = async (req, res) => {
  try {
    const { employeeId, descriptor } = req.body;

    if (!employeeId)
      return res.status(400).json({ success: false, message: 'employeeId is required' });
    if (!Array.isArray(descriptor) || descriptor.length !== 128)
      return res.status(400).json({ success: false, message: 'Invalid face descriptor' });

    // Fetch employee + stored descriptor
    const empRes = await pool.query(
      `SELECT id, first_name, last_name, face_descriptor, work_start_time, status
       FROM employees WHERE id=$1`,
      [employeeId]
    );

    if (!empRes.rows[0])
      return res.status(404).json({ success: false, message: 'Employee not found' });
    if (empRes.rows[0].status !== 'active')
      return res.status(403).json({ success: false, message: 'Employee account is not active' });
    if (!empRes.rows[0].face_descriptor)
      return res.status(400).json({
        success: false,
        message: 'Face not registered. Please register your face first from your profile settings.',
      });

    const emp = empRes.rows[0];

    // Parse JSONB → JS array
    const stored = Array.isArray(emp.face_descriptor)
      ? emp.face_descriptor
      : (typeof emp.face_descriptor === 'string' ? JSON.parse(emp.face_descriptor) : emp.face_descriptor);

    const distance = euclideanDistance(descriptor, stored);
    // Convert distance to a 0–100 confidence score
    const confidence = Math.max(0, Math.min(100, Math.round((1 - distance / 1.2) * 100)));

    // face-api.js: distance < 0.5 is a reliable match (< 0.4 is excellent)
    const THRESHOLD = 0.5;

    // Log the attempt (both success and failure)
    const logAttempt = async (status) => {
      try {
        await pool.query(
          `INSERT INTO face_attendance_logs (employee_id, date, confidence, distance, status)
           VALUES ($1, CURRENT_DATE, $2, $3, $4)`,
          [employeeId, confidence, parseFloat(distance.toFixed(4)), status]
        );
      } catch {}
    };

    if (distance > THRESHOLD) {
      await logAttempt('failed');
      return res.status(401).json({
        success: false,
        message: 'Face not recognized. Please look directly at the camera and try again.',
        confidence,
        distance: parseFloat(distance.toFixed(4)),
      });
    }

    // ── Mark attendance ────────────────────────────────────────────────────
    const today = new Date().toISOString().split('T')[0];
    const existing = await pool.query(
      'SELECT check_in FROM attendance WHERE employee_id=$1 AND date=$2',
      [employeeId, today]
    );

    if (existing.rows[0]?.check_in) {
      await logAttempt('already_in');
      return res.status(409).json({ success: false, message: 'Already checked in today' });
    }

    const settings = await getSettings();
    const now = new Date();
    const [h, m] = (emp.work_start_time || '09:00').split(':').map(Number);
    const scheduled = new Date(now);
    scheduled.setHours(h, m, 0, 0);
    const lateMinutes = Math.max(0, Math.round((now - scheduled) / 60000));
    const attStatus = resolveStatus(lateMinutes, settings);

    const r = await pool.query(
      `INSERT INTO attendance (employee_id, date, check_in, status, late_minutes, notes)
       VALUES ($1, $2, $3, $4, $5, 'Face Recognition Check-in')
       ON CONFLICT (employee_id, date)
         DO UPDATE SET check_in=$3, status=$4, late_minutes=$5,
                       notes='Face Recognition Check-in', updated_at=NOW()
       RETURNING *`,
      [employeeId, today, now, attStatus, lateMinutes]
    );

    await logAttempt('success');

    res.json({
      success: true,
      message: `Welcome, ${emp.first_name}! Check-in successful.`,
      data: { ...r.rows[0], confidence, distance: parseFloat(distance.toFixed(4)) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /face/logs ─────────────────────────────────────────────────────────
exports.getLogs = async (req, res) => {
  try {
    const { date, employeeId, status, page = 1, limit = 20 } = req.query;
    const conditions = [];
    const params = [];

    if (date)       { params.push(date);       conditions.push(`f.date=$${params.length}`); }
    if (employeeId) { params.push(employeeId); conditions.push(`f.employee_id=$${params.length}`); }
    if (status)     { params.push(status);     conditions.push(`f.status=$${params.length}`); }

    const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (Math.max(1, +page) - 1) * Math.min(100, +limit);

    const [rows, count] = await Promise.all([
      pool.query(
        `SELECT f.*, e.first_name, e.last_name, e.employee_code
         FROM face_attendance_logs f
         LEFT JOIN employees e ON e.id = f.employee_id
         ${where}
         ORDER BY f.checked_in_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, Math.min(100, +limit), offset]
      ),
      pool.query(`SELECT COUNT(*) FROM face_attendance_logs f ${where}`, params),
    ]);

    res.json({
      success: true,
      data: rows.rows.map((r) => ({
        id: r.id,
        employee: {
          firstName: r.first_name, lastName: r.last_name, employeeCode: r.employee_code,
        },
        date: r.date,
        checkedInAt: r.checked_in_at,
        confidence: r.confidence,
        distance: r.distance,
        status: r.status,
      })),
      pagination: {
        total: +count.rows[0].count, page: +page, limit: +limit,
        pages: Math.ceil(+count.rows[0].count / Math.min(100, +limit)),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
