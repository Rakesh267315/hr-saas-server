const router = require('express').Router();
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    // Live employee count per department — always accurate, never stale
    const r = await pool.query(`
      SELECT
        d.*,
        COUNT(e.id) FILTER (WHERE e.status = 'active') AS employee_count
      FROM departments d
      LEFT JOIN employees e ON e.department_id = d.id
      WHERE d.is_active = true
      GROUP BY d.id
      ORDER BY d.name
    `);
    const depts = r.rows.map((d) => ({
      ...d,
      _id: d.id,
      headCount: parseInt(d.employee_count) || 0,
    }));
    res.json({ success: true, data: depts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/', authorize('admin', 'super_admin'), async (req, res) => {
  try {
    const { name, code, description } = req.body;
    const r = await pool.query(
      `INSERT INTO departments (name,code,description) VALUES ($1,$2,$3) RETURNING *`,
      [name, code || null, description || null]
    );
    res.status(201).json({ success: true, data: { ...r.rows[0], _id: r.rows[0].id } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ success: false, message: 'Department already exists' });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch('/:id', authorize('admin', 'super_admin'), async (req, res) => {
  try {
    const { name, code, description, isActive, managerId } = req.body;
    const r = await pool.query(
      `UPDATE departments SET
        name=COALESCE($1,name), code=COALESCE($2,code), description=COALESCE($3,description),
        is_active=COALESCE($4,is_active), manager_id=COALESCE($5,manager_id), updated_at=NOW()
       WHERE id=$6 RETURNING *`,
      [name, code, description, isActive, managerId, req.params.id]
    );
    res.json({ success: true, data: { ...r.rows[0], _id: r.rows[0].id } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:id', authorize('admin', 'super_admin'), async (req, res) => {
  try {
    await pool.query(`UPDATE departments SET is_active=false WHERE id=$1`, [req.params.id]);
    res.json({ success: true, message: 'Department deactivated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
