const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/performanceController');

router.use(authenticate);

// Goals
router.get('/goals',           ctrl.getGoals);
router.post('/goals',          authorize('admin','hr','super_admin'), ctrl.createGoal);
router.patch('/goals/:id',     authorize('admin','hr','super_admin'), ctrl.updateGoal);
router.delete('/goals/:id',    authorize('admin','hr','super_admin'), ctrl.deleteGoal);

// Reviews
router.get('/reviews',         ctrl.getReviews);
router.post('/reviews',        authorize('admin','hr','super_admin'), ctrl.createReview);
router.patch('/reviews/:id',   authorize('admin','hr','super_admin'), ctrl.updateReview);

// Summary
router.get('/summary/:employeeId', ctrl.getSummary);

module.exports = router;
