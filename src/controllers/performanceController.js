const pool = require('../config/db');

// ── Format helpers ────────────────────────────────────────────────────────────
const fmtGoal = (r) => ({
  id: r.id,
  employeeId: r.employee_id,
  employeeName: r.first_name ? `${r.first_name} ${r.last_name || ''}`.trim() : null,
  employeeCode: r.employee_code,
  title: r.title,
  description: r.description,
  category: r.category,
  targetDate: r.target_date,
  progress: r.progress,
  status: r.status,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const fmtReview = (r) => ({
  id: r.id,
  employeeId: r.employee_id,
  employeeName: r.emp_first_name ? `${r.emp_first_name} ${r.emp_last_name || ''}`.trim() : null,
  employeeCode: r.employee_code,
  reviewerName: r.reviewer_name,
  reviewPeriod: r.review_period,
  reviewDate: r.review_date,
  overallRating: parseFloat(r.overall_rating) || 0,
  ratings: {
    workQuality: parseFloat(r.work_quality) || 0,
    punctuality: parseFloat(r.punctuality) || 0,
    teamwork: parseFloat(r.teamwork) || 0,
    communication: parseFloat(r.communication) || 0,
    leadership: parseFloat(r.leadership) || 0,
  },
  strengths: r.strengths,
  improvements: r.improvements,
  comments: r.comments,
  status: r.status,
  createdAt: r.created_at,
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GOALS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /performance/goals
exports.getGoals = async (req, res) => {
  try {
    const { employeeId, status, page = 1, limit = 20 } = req.query;
    const conds = []; const params = [];

    // Employees see only their own goals
    if (req.user.role === 'employee') {
      const mine = await pool.query(
        'SELECT id FROM employees WHERE user_id=$1', [req.user.id]
      );
      if (!mine.rows[0]) return res.json({ success: true, data: [] });
      params.push(mine.rows[0].id);
      conds.push(`g.employee_id=$${params.length}`);
    } else if (employeeId) {
      params.push(employeeId);
      conds.push(`g.employee_id=$${params.length}`);
    }

    if (status) { params.push(status); conds.push(`g.status=$${params.length}`); }

    const where  = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const offset = (Math.max(1, +page) - 1) * Math.min(50, +limit);

    const [rows, total] = await Promise.all([
      pool.query(
        `SELECT g.*, e.first_name, e.last_name, e.employee_code
         FROM performance_goals g
         LEFT JOIN employees e ON e.id = g.employee_id
         ${where}
         ORDER BY g.created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, Math.min(50, +limit), offset]
      ),
      pool.query(`SELECT COUNT(*) FROM performance_goals g ${where}`, params),
    ]);

    res.json({
      success: true,
      data: rows.rows.map(fmtGoal),
      pagination: {
        total: +total.rows[0].count,
        page: +page,
        limit: +limit,
        pages: Math.ceil(+total.rows[0].count / +limit),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /performance/goals
exports.createGoal = async (req, res) => {
  try {
    const { employeeId, title, description, category, targetDate, progress = 0 } = req.body;
    if (!employeeId || !title)
      return res.status(400).json({ success: false, message: 'employeeId and title are required' });

    const r = await pool.query(
      `INSERT INTO performance_goals
         (employee_id, title, description, category, target_date, progress, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [employeeId, title, description || null, category || 'professional',
       targetDate || null, progress, req.user.id]
    );
    res.status(201).json({ success: true, data: fmtGoal(r.rows[0]) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /performance/goals/:id
exports.updateGoal = async (req, res) => {
  try {
    const { title, description, category, targetDate, progress, status } = req.body;
    const fields = []; const vals = [];

    if (title !== undefined)       { vals.push(title);          fields.push(`title=$${vals.length}`); }
    if (description !== undefined) { vals.push(description);    fields.push(`description=$${vals.length}`); }
    if (category !== undefined)    { vals.push(category);       fields.push(`category=$${vals.length}`); }
    if (targetDate !== undefined)  { vals.push(targetDate);     fields.push(`target_date=$${vals.length}`); }
    if (progress !== undefined)    { vals.push(progress);       fields.push(`progress=$${vals.length}`); }
    if (status !== undefined)      { vals.push(status);         fields.push(`status=$${vals.length}`); }

    if (!fields.length)
      return res.status(400).json({ success: false, message: 'No fields to update' });

    vals.push(new Date()); fields.push(`updated_at=$${vals.length}`);
    vals.push(req.params.id);

    const r = await pool.query(
      `UPDATE performance_goals SET ${fields.join(',')}
       WHERE id=$${vals.length} RETURNING *`,
      vals
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Goal not found' });
    res.json({ success: true, data: fmtGoal(r.rows[0]) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /performance/goals/:id
exports.deleteGoal = async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM performance_goals WHERE id=$1 RETURNING id`, [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Goal not found' });
    res.json({ success: true, message: 'Goal deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  REVIEWS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /performance/reviews
exports.getReviews = async (req, res) => {
  try {
    const { employeeId, page = 1, limit = 20 } = req.query;
    const conds = []; const params = [];

    if (req.user.role === 'employee') {
      const mine = await pool.query(
        'SELECT id FROM employees WHERE user_id=$1', [req.user.id]
      );
      if (!mine.rows[0]) return res.json({ success: true, data: [] });
      params.push(mine.rows[0].id);
      conds.push(`r.employee_id=$${params.length}`);
    } else if (employeeId) {
      params.push(employeeId);
      conds.push(`r.employee_id=$${params.length}`);
    }

    const where  = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const offset = (Math.max(1, +page) - 1) * Math.min(50, +limit);

    const rows = await pool.query(
      `SELECT r.*,
              e.first_name AS emp_first_name, e.last_name AS emp_last_name, e.employee_code,
              u.name AS reviewer_name
       FROM performance_reviews r
       LEFT JOIN employees e ON e.id = r.employee_id
       LEFT JOIN users u ON u.id = r.reviewer_id
       ${where}
       ORDER BY r.review_date DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, Math.min(50, +limit), offset]
    );

    res.json({ success: true, data: rows.rows.map(fmtReview) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /performance/reviews
exports.createReview = async (req, res) => {
  try {
    const {
      employeeId, reviewPeriod, reviewDate,
      overallRating, workQuality, punctuality, teamwork, communication, leadership,
      strengths, improvements, comments, status = 'submitted',
    } = req.body;

    if (!employeeId || !overallRating)
      return res.status(400).json({ success: false, message: 'employeeId and overallRating are required' });

    const r = await pool.query(
      `INSERT INTO performance_reviews
         (employee_id, reviewer_id, review_period, review_date, overall_rating,
          work_quality, punctuality, teamwork, communication, leadership,
          strengths, improvements, comments, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [employeeId, req.user.id, reviewPeriod, reviewDate || new Date(),
       overallRating, workQuality || overallRating, punctuality || overallRating,
       teamwork || overallRating, communication || overallRating, leadership || overallRating,
       strengths, improvements, comments, status]
    );

    // Notify the employee
    try {
      const empUser = await pool.query(
        'SELECT user_id FROM employees WHERE id=$1', [employeeId]
      );
      if (empUser.rows[0]?.user_id) {
        const { createNotification } = require('./notificationController');
        await createNotification(empUser.rows[0].user_id, {
          type: 'review',
          title: 'Performance Review Submitted',
          message: `Your performance review for ${reviewPeriod || 'this period'} has been submitted.`,
          link: '/employee/performance',
        });
      }
    } catch {}

    res.status(201).json({ success: true, data: fmtReview(r.rows[0]) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /performance/reviews/:id
exports.updateReview = async (req, res) => {
  try {
    const {
      overallRating, workQuality, punctuality, teamwork, communication, leadership,
      strengths, improvements, comments, status,
    } = req.body;
    const fields = []; const vals = [];

    const map = {
      overall_rating: overallRating, work_quality: workQuality,
      punctuality, teamwork, communication, leadership,
      strengths, improvements, comments, status,
    };
    for (const [col, val] of Object.entries(map)) {
      if (val !== undefined) { vals.push(val); fields.push(`${col}=$${vals.length}`); }
    }
    if (!fields.length)
      return res.status(400).json({ success: false, message: 'No fields to update' });

    vals.push(new Date()); fields.push(`updated_at=$${vals.length}`);
    vals.push(req.params.id);

    const r = await pool.query(
      `UPDATE performance_reviews SET ${fields.join(',')}
       WHERE id=$${vals.length} RETURNING *`,
      vals
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Review not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /performance/summary/:employeeId
exports.getSummary = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const [goals, reviews] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status='active')    AS active,
           COUNT(*) FILTER (WHERE status='completed') AS completed,
           COUNT(*) FILTER (WHERE status='overdue')   AS overdue,
           AVG(progress) FILTER (WHERE status='active') AS avg_progress
         FROM performance_goals WHERE employee_id=$1`,
        [employeeId]
      ),
      pool.query(
        `SELECT
           COUNT(*)         AS total_reviews,
           AVG(overall_rating) AS avg_rating,
           MAX(review_date) AS last_review
         FROM performance_reviews WHERE employee_id=$1`,
        [employeeId]
      ),
    ]);

    const g = goals.rows[0];
    const rv = reviews.rows[0];

    res.json({
      success: true,
      data: {
        goals: {
          active: +g.active,
          completed: +g.completed,
          overdue: +g.overdue,
          avgProgress: Math.round(parseFloat(g.avg_progress) || 0),
        },
        reviews: {
          total: +rv.total_reviews,
          avgRating: parseFloat(parseFloat(rv.avg_rating || 0).toFixed(1)),
          lastReview: rv.last_review,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
