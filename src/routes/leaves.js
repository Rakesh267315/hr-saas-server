const router = require('express').Router();
const ctrl = require('../controllers/leaveController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getOne);
router.post('/', ctrl.apply);
router.patch('/:id/status', authorize('admin', 'hr', 'super_admin'), ctrl.updateStatus);
router.patch('/:id/cancel', ctrl.cancel);
router.get('/balance/:id', ctrl.getBalance);

module.exports = router;
