const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/breakController');

router.use(authenticate);

router.get('/today', authorize('super_admin', 'admin', 'hr'), ctrl.getToday);
router.get('/employee/:id', ctrl.getByEmployee);
router.post('/start', ctrl.startBreak);
router.post('/end', ctrl.endBreak);

module.exports = router;
