const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/notificationController');

router.use(authenticate);

router.get('/',                   ctrl.getAll);
router.patch('/read-all',         ctrl.markAllRead);
router.patch('/:id/read',         ctrl.markRead);
router.delete('/clear',           ctrl.clearAll);

module.exports = router;
