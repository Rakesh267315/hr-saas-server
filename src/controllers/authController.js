const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

const fmtEmp = (e) => {
  if (!e) return null;
  return {
    _id: e.id, id: e.id,
    employeeCode: e.employee_code,
    firstName: e.first_name, lastName: e.last_name,
    fullName: `${e.first_name} ${e.last_name || ''}`.trim(),
    designation: e.designation,
    department: e.department_id ? { _id: e.department_id, id: e.department_id, name: e.department_name } : null,
    avatar: e.avatar,
  };
};

exports.register = async (req, res) => {
  try {
    const { name, password, role } = req.body;
    const email = req.body.email?.trim().toLowerCase();
    const exists = await pool.query('SELECT id FROM users WHERE LOWER(email)=$1', [email]);
    if (exists.rows.length)
      return res.status(409).json({ success: false, message: 'Email already registered' });

    const hashed = await bcrypt.hash(password, 12);
    const r = await pool.query(
      `INSERT INTO users (name,email,password,role) VALUES ($1,$2,$3,$4) RETURNING *`,
      [name, email, hashed, role || 'employee']
    );
    const user = r.rows[0]; delete user.password;
    res.status(201).json({ success: true, token: signToken(user.id), data: { user: { ...user, _id: user.id } } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    // LOWER() makes login case-insensitive — Rakesh@... == rakesh@... == RAKESH@...
    const r = await pool.query('SELECT * FROM users WHERE LOWER(email)=LOWER($1)', [email?.trim()]);
    const user = r.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    if (!user.is_active)
      return res.status(403).json({ success: false, message: 'Account deactivated' });

    await pool.query('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);

    let employee = null;
    if (user.employee_id) {
      const er = await pool.query(
        `SELECT e.*, d.name AS department_name FROM employees e
         LEFT JOIN departments d ON d.id=e.department_id WHERE e.id=$1`,
        [user.employee_id]
      );
      employee = fmtEmp(er.rows[0]);
    }

    delete user.password;
    res.json({
      success: true,
      token: signToken(user.id),
      data: {
        user: { _id: user.id, id: user.id, name: user.name, email: user.email, role: user.role, avatar: user.avatar },
        employee,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getMe = async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    const user = r.rows[0]; delete user.password;
    let employee = null;
    if (user.employee_id) {
      const er = await pool.query(
        `SELECT e.*, d.name AS department_name FROM employees e
         LEFT JOIN departments d ON d.id=e.department_id WHERE e.id=$1`,
        [user.employee_id]
      );
      employee = fmtEmp(er.rows[0]);
    }
    res.json({ success: true, data: { user: { ...user, _id: user.id }, employee } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const r = await pool.query('SELECT password FROM users WHERE id=$1', [req.user.id]);
    if (!(await bcrypt.compare(currentPassword, r.rows[0].password)))
      return res.status(401).json({ success: false, message: 'Current password incorrect' });
    const hashed = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password=$1,updated_at=NOW() WHERE id=$2', [hashed, req.user.id]);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
