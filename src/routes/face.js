const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/faceController');

router.use(authenticate);

// Employee + admin: register face
router.post('/:id/register', ctrl.register);

// Admin / HR only: delete face data
router.delete('/:id', authorize('admin', 'hr', 'super_admin'), ctrl.deleteFace);

// Get face registration status
router.get('/logs', authorize('admin', 'hr', 'super_admin'), ctrl.getLogs);
router.get('/:id/status', ctrl.status);

// Face-based attendance check-in
router.post('/checkin', ctrl.faceCheckin);

module.exports = router;
