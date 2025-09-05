import express from 'express';
import {
  getUsers,
  getUser,
  updateUser,
  getGames,
  getGame,
  createGame,
  updateGame,
  getTransactions,
  updateTransaction,
  getAnalytics,
} from '../controllers/adminController';
import { authenticate, authorize } from '../middleware/auth';

const router = express.Router();

// All admin routes require authentication and admin role
router.use(authenticate);
router.use(authorize('admin'));

// User management
router.get('/users', getUsers);
router.get('/users/:id', getUser);
router.put('/users/:id', updateUser);

// Game management
router.get('/games', getGames);
router.get('/games/:id', getGame);
router.post('/games', createGame);
router.put('/games/:id', updateGame);

// Transaction management
router.get('/transactions', getTransactions);
router.put('/transactions/:id', updateTransaction);

// Analytics
router.get('/analytics', getAnalytics);

export default router;