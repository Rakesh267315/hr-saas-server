const router = require('express').Router();
const ctrl = require('../controllers/payrollController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/preview', authorize('admin', 'hr', 'super_admin'), ctrl.preview);
router.get('/summary', authorize('admin', 'hr', 'super_admin'), ctrl.getSummary);
router.post('/generate', authorize('admin', 'hr', 'super_admin'), ctrl.generate);
router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getOne);
router.patch('/:id/status', authorize('admin', 'super_admin'), ctrl.updateStatus);

module.exports = router;
