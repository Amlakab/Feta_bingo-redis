import express from 'express';
import {
  getDashboard,
  getUsers,
  getGames,
  getTransactions,
} from '../controllers/agentController';
import { authenticate, authorize } from '../middleware/auth';

const router = express.Router();

// All agent routes require authentication and agent role
router.use(authenticate);
router.use(authorize('agent'));

router.get('/dashboard', getDashboard);
router.get('/users', getUsers);
router.get('/games', getGames);
router.get('/transactions', getTransactions);

export default router;