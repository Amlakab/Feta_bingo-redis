import express from 'express';
import { 
  getWallet,
  getTransactions,
  initializeDeposit,
  verifyDeposit,
  handleWebhook,
  requestWithdrawal,
  getWinnings
} from '../controllers/walletController';
import { authenticate } from '../middleware/auth';
import { paymentLimiter } from '../middleware/rateLimit';

const router = express.Router();

// Get wallet info
router.get('/', authenticate, getWallet);

// Get transaction history
router.get('/transactions', authenticate, getTransactions);

// Get winnings
router.get('/winnings', authenticate, getWinnings);

// Deposit
router.post('/deposit', paymentLimiter, authenticate, initializeDeposit);

// Verify deposit (after redirect from Chapa)
router.get('/deposit/verify/:tx_ref', authenticate, verifyDeposit);

// Webhook (Chapa calls this)
router.post('/webhook', handleWebhook);

// Withdraw funds
router.post('/withdraw', paymentLimiter, authenticate, requestWithdrawal);

export default router;