import express from 'express';
import Transaction, { ITransaction } from '../models/Transaction';
import { authenticate } from '../middleware/auth';

const router = express.Router();

// GET all transactions with pagination and filtering
router.get('/', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const type = req.query.type as string;
    const status = req.query.status as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const skip = (page - 1) * limit;
    
    // Build filter object
    const filter: any = {};
    
    if (type) filter.type = type;
    if (status) filter.status = status;
    
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const transactions = await Transaction.find(filter)
      .populate('userId', 'phone name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Transaction.countDocuments(filter);
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: transactions,
      pagination: {
        current: page,
        total: totalPages,
        count: transactions.length,
        totalRecords: total
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Error fetching transactions',
      error: error.message
    });
  }
});

// GET transactions by user ID
router.get('/user/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const type = req.query.type as string;
    const status = req.query.status as string;

    const skip = (page - 1) * limit;
    
    // Build filter object
    const filter: any = { userId };
    
    if (type) filter.type = type;
    if (status) filter.status = status;

    const transactions = await Transaction.find(filter)
      .populate('userId', 'phone name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Transaction.countDocuments(filter);
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: transactions,
      pagination: {
        current: page,
        total: totalPages,
        count: transactions.length,
        totalRecords: total
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Error fetching user transactions',
      error: error.message
    });
  }
});

// GET transaction by ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id)
      .populate('userId', 'phone name');

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    res.json({
      success: true,
      data: transaction
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Error fetching transaction',
      error: error.message
    });
  }
});

// GET transaction statistics
router.get('/stats/overview', authenticate, async (req, res) => {
  try {
    const { userId } = req.query;
    const filter: any = userId ? { userId } : {};

    const totalTransactions = await Transaction.countDocuments(filter);
    
    const totalDeposits = await Transaction.aggregate([
      { $match: { ...filter, type: 'deposit', status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    const totalWithdrawals = await Transaction.aggregate([
      { $match: { ...filter, type: 'withdrawal', status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    const totalWinnings = await Transaction.aggregate([
      { $match: { ...filter, type: 'winning', status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    const totalGamePurchases = await Transaction.aggregate([
      { $match: { ...filter, type: 'game_purchase', status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const recentTransactions = await Transaction.find(filter)
      .populate('userId', 'phone name')
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({
      success: true,
      data: {
        totalTransactions,
        totalDeposits: totalDeposits[0]?.total || 0,
        totalWithdrawals: totalWithdrawals[0]?.total || 0,
        totalWinnings: totalWinnings[0]?.total || 0,
        totalGamePurchases: totalGamePurchases[0]?.total || 0,
        netBalance: (totalWinnings[0]?.total || 0) + (totalDeposits[0]?.total || 0) - 
                   (totalWithdrawals[0]?.total || 0) - (totalGamePurchases[0]?.total || 0),
        recentTransactions
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Error fetching transaction statistics',
      error: error.message
    });
  }
});

export default router;