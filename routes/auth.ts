import express from 'express';
import {
  register,
  login,
  sendOtp,
  loginWithOtp,
  getProfile,
  changePassword,
} from '../controllers/authController';
import { authenticate } from '../middleware/auth';
import { validateRegistration, validateLogin } from '../middleware/validation';
import { authLimiter } from '../middleware/rateLimit';

const router = express.Router();

router.post('/register', authLimiter, validateRegistration, register);
router.post('/login', authLimiter, validateLogin, login);
router.post('/send-otp', authLimiter, sendOtp);
router.post('/login-otp', authLimiter, loginWithOtp);
router.get('/profile', authenticate, getProfile);
router.put('/change-password', authenticate, changePassword);

export default router;