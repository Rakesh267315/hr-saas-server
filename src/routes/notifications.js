const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/notificationController');

router.use(authenticate);

router.get('/',                   ctrl.getAll);
router.get('/voice-messages',     ctrl.getVoiceMessages);
router.post('/send-voice',        authorize('admin','hr','super_admin'), ctrl.sendVoiceMessage);
router.patch('/read-all',         ctrl.markAllRead);
router.patch('/:id/read',         ctrl.markRead);
router.delete('/clear',           ctrl.clearAll);

module.exports = router;
