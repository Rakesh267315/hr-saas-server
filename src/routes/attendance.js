const router = require('express').Router();
const ctrl = require('../controllers/attendanceController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/today',                authorize('admin', 'hr', 'super_admin'), ctrl.getToday);
router.get('/all',                  authorize('admin', 'hr', 'super_admin'), ctrl.getAllAttendance);
router.post('/check-in',            ctrl.checkIn);
router.post('/check-out',           ctrl.checkOut);
router.get('/employee/:id',         ctrl.getByEmployee);
router.get('/employee/:id/summary', ctrl.getSummary);
router.post('/mark-absent',         authorize('admin', 'hr', 'super_admin'), ctrl.markAbsent);
router.post('/recalculate',         authorize('admin', 'hr', 'super_admin'), ctrl.recalculate);
router.post('/backfill',            authorize('admin', 'hr', 'super_admin'), ctrl.backfill);
router.post('/bulk-entry',          authorize('admin', 'hr', 'super_admin'), ctrl.bulkEntry);
router.patch('/:id/correct',        authorize('admin', 'hr', 'super_admin'), ctrl.correctAttendance);
router.patch('/:id/unlock',         authorize('admin', 'hr', 'super_admin'), ctrl.unlockAttendance);

module.exports = router;
