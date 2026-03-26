const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/settingsController');

router.get('/', authenticate, ctrl.get);
router.patch('/', authenticate, authorize('super_admin', 'admin'), ctrl.update);

module.exports = router;
