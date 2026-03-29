const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.post('/register',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password')
      .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
      .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
      .matches(/[0-9]/).withMessage('Password must contain at least one number'),
    body('role').optional().isIn(['admin', 'hr', 'employee']).withMessage('Invalid role'),
  ],
  validate,
  ctrl.register
);

router.post('/login',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validate,
  ctrl.login
);

router.get('/me', authenticate, ctrl.getMe);

router.patch('/update-profile',
  authenticate,
  [
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
    body('email').optional().isEmail().normalizeEmail().withMessage('Valid email required'),
  ],
  validate,
  ctrl.updateProfile
);

router.patch('/change-password',
  authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword')
      .isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
      .matches(/[A-Z]/).withMessage('Must contain at least one uppercase letter')
      .matches(/[0-9]/).withMessage('Must contain at least one number'),
  ],
  validate,
  ctrl.changePassword
);

module.exports = router;
