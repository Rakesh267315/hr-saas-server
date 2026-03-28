const router = require('express').Router();
const ctrl = require('../controllers/employeeController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/stats', authorize('admin', 'hr', 'super_admin'), ctrl.getStats);
router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getOne);
router.post('/', authorize('admin', 'hr', 'super_admin'), ctrl.create);
router.patch('/:id', authorize('admin', 'hr', 'super_admin'), ctrl.update);
router.patch('/:id/credentials', authorize('admin', 'hr', 'super_admin'), ctrl.updateCredentials);
router.delete('/:id', authorize('admin', 'super_admin'), ctrl.remove);

module.exports = router;
