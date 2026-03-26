const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.split(' ')[1]
    : null;
  if (!token) return res.status(401).json({ success: false, message: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const r = await pool.query('SELECT * FROM users WHERE id=$1', [decoded.id]);
    req.user = r.rows[0];
    if (!req.user || !req.user.is_active)
      return res.status(401).json({ success: false, message: 'User not found or inactive' });
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role))
    return res.status(403).json({ success: false, message: 'Access denied' });
  next();
};

module.exports = { authenticate, authorize };
