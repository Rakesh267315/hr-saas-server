const pool = require('../config/db');

exports.startBreak = async (req, res) => {
  try {
    const { employeeId } = req.body;
    const today = new Date().toISOString().split('T')[0];
    const active = await pool.query(
      `SELECT id FROM breaks WHERE employee_id=$1 AND date=$2 AND end_time IS NULL`,
      [employeeId, today]
    );
    if (active.rows.length) return res.status(409).json({ success: false, message: 'Break already in progress' });

    const r = await pool.query(
      `INSERT INTO breaks (employee_id,user_id,date,start_time) VALUES ($1,$2,$3,NOW()) RETURNING *`,
      [employeeId, req.user.id, today]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.endBreak = async (req, res) => {
  try {
    const { employeeId } = req.body;
    const today = new Date().toISOString().split('T')[0];
    const r = await pool.query(
      `UPDATE breaks SET end_time=NOW(), duration_minutes=ROUND(EXTRACT(EPOCH FROM (NOW()-start_time))/60)
       WHERE employee_id=$1 AND date=$2 AND end_time IS NULL RETURNING *`,
      [employeeId, today]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'No active break found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getToday = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const r = await pool.query(
      `SELECT b.*, e.first_name, e.last_name, e.employee_code, e.designation, e.department_id
       FROM breaks b JOIN employees e ON e.id=b.employee_id WHERE b.date=$1 ORDER BY b.start_time DESC`,
      [today]
    );

    const map = new Map();
    for (const b of r.rows) {
      if (!map.has(b.employee_id)) {
        map.set(b.employee_id, {
          employee: { _id: b.employee_id, id: b.employee_id, firstName: b.first_name, lastName: b.last_name, employeeCode: b.employee_code, designation: b.designation },
          totalMinutes: 0, isOnBreak: false, breakCount: 0, currentBreakStart: null,
        });
      }
      const entry = map.get(b.employee_id);
      entry.breakCount++;
      if (!b.end_time) {
        entry.isOnBreak = true;
        entry.currentBreakStart = b.start_time;
        entry.totalMinutes += Math.round((new Date() - new Date(b.start_time)) / 60000);
      } else {
        entry.totalMinutes += b.duration_minutes || 0;
      }
    }

    const data = Array.from(map.values());
    res.json({ success: true, data, onBreakCount: data.filter((e) => e.isOnBreak).length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getByEmployee = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const r = await pool.query(
      `SELECT * FROM breaks WHERE employee_id=$1 AND date=$2 ORDER BY start_time ASC`,
      [req.params.id, today]
    );
    const totalMinutes = r.rows.reduce((sum, b) => {
      if (b.end_time) return sum + (b.duration_minutes || 0);
      return sum + Math.round((new Date() - new Date(b.start_time)) / 60000);
    }, 0);
    res.json({ success: true, data: r.rows, totalMinutes });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
