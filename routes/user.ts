import express from 'express';
import { 
  getAllUsers,
  createUser,
  updateUserStatus,
  deleteUser,
  getUserStatistics,
  getUser,
  updateWallet,
  updateEarnings,
  changePassword,
  setWallet,
  minusWallet
} from '../controllers/userController';
import { authenticate } from '../middleware/auth';

const router = express.Router();

// Public routes
router.post('/register', createUser);

// Protected routes (require authentication)
router.get('/stats', authenticate, getUserStatistics);
router.get('/', authenticate, getAllUsers);
router.get('/:userId', authenticate, getUser);
router.put('/wallet', authenticate, updateWallet);
router.put('/earnings', authenticate, updateEarnings);
router.patch('/:userId/status', authenticate, updateUserStatus);
router.delete('/:userId', authenticate, deleteUser);
router.put('/change-password', authenticate, changePassword);
router.put('/update-wallet', authenticate, setWallet);
router.put('/minus-wallet', authenticate, minusWallet);

export default router;