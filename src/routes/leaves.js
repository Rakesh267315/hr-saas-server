const router = require('express').Router();
const ctrl = require('../controllers/leaveController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/', ctrl.getAll);
router.post('/', ctrl.apply);
// Override routes (must be before /:id to avoid conflict)
router.post('/override', authorize('admin', 'hr', 'super_admin'), ctrl.setOverride);
router.get('/overrides', authorize('admin', 'hr', 'super_admin'), ctrl.getOverrides);
router.delete('/override/:id', authorize('admin', 'hr', 'super_admin'), ctrl.deleteOverride);
// Admin manual leave entry
router.post('/admin/manual', authorize('admin', 'hr', 'super_admin'), ctrl.adminAddLeave);
// Parameterised routes last
router.get('/balance/:id', ctrl.getBalance);
router.get('/monthly-balance/:id', ctrl.getMonthlyBalance);
router.patch('/:id/status', authorize('admin', 'hr', 'super_admin'), ctrl.updateStatus);
router.patch('/:id/cancel', ctrl.cancel);
router.get('/:id', ctrl.getOne);

module.exports = router;
