const pool = require('../config/db');

// ── Helper: create a notification for one or many users ───────────────────────
const createNotification = async (userIds, { type, title, message, link = null }) => {
  if (!userIds || userIds.length === 0) return;
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  try {
    for (const userId of ids) {
      if (!userId) continue;
      await pool.query(
        `INSERT INTO notifications (user_id, type, title, message, link)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, type, title, message, link]
      );
    }
  } catch (err) {
    console.error('[NOTIF] Failed to create notification:', err.message);
  }
};
exports.createNotification = createNotification;

// ── GET /notifications — list for current user ────────────────────────────────
exports.getAll = async (req, res) => {
  try {
    const { limit = 30, unread_only } = req.query;
    const where = unread_only === 'true' ? 'WHERE user_id=$1 AND is_read=false' : 'WHERE user_id=$1';
    const [rows, countRow] = await Promise.all([
      pool.query(
        `SELECT * FROM notifications ${where}
         ORDER BY created_at DESC LIMIT $2`,
        [req.user.id, Math.min(+limit, 100)]
      ),
      pool.query(
        `SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND is_read=false`,
        [req.user.id]
      ),
    ]);
    res.json({
      success: true,
      data: rows.rows,
      unreadCount: parseInt(countRow.rows[0].count),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /notifications/read-all — mark all read ─────────────────────────────
exports.markAllRead = async (req, res) => {
  try {
    await pool.query(
      `UPDATE notifications SET is_read=true WHERE user_id=$1`,
      [req.user.id]
    );
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /notifications/:id/read — mark single read ─────────────────────────
exports.markRead = async (req, res) => {
  try {
    await pool.query(
      `UPDATE notifications SET is_read=true WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /notifications/clear — delete all for current user ─────────────────
exports.clearAll = async (req, res) => {
  try {
    await pool.query(`DELETE FROM notifications WHERE user_id=$1`, [req.user.id]);
    res.json({ success: true, message: 'Notifications cleared' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
