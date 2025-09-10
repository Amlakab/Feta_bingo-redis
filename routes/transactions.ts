import express from 'express';
import Transaction, { ITransaction } from '../models/Transaction';
import User from '../models/User';
import { authenticate } from '../middleware/auth';

const router = express.Router();

// GET all transactions with pagination and filtering
router.get('/', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const type = req.query.type as string;
    const status = req.query.status as string;
    const reference = req.query.reference as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const search = req.query.search as string;

    const skip = (page - 1) * limit;
    
    // Build filter object
    const filter: any = {};
    
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (reference) filter.reference = reference;
    
    if (search) {
      filter.$or = [
        { transactionId: { $regex: search, $options: 'i' } },
        { senderPhone: { $regex: search, $options: 'i' } },
        { senderName: { $regex: search, $options: 'i' } },
        { receiverPhone: { $regex: search, $options: 'i' } },
        { receiverName: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    
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
      .sort({ createdAt: -1, status: 1 }) // Pending first, then by date
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

    const pendingDeposits = await Transaction.countDocuments({ 
      ...filter, 
      type: 'deposit', 
      status: 'pending' 
    });
    
    const pendingWithdrawals = await Transaction.countDocuments({ 
      ...filter, 
      type: 'withdrawal', 
      status: 'pending' 
    });

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
        pendingDeposits,
        pendingWithdrawals,
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

// CREATE new transaction (for both deposit and withdrawal)
router.post('/', authenticate, async (req, res) => {
  try {
    const {
      userId,
      type,
      amount,
      reference,
      description,
      transactionId,
      senderPhone,
      senderName,
      receiverPhone,
      receiverName,
      method,
      metadata
    } = req.body;
   
    // Validate required fields
    if (!userId || !type || !amount || !reference) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: userId, type, amount, reference'
      });
    }

    // Validate transaction type
    if (!['deposit', 'withdrawal', 'game_purchase', 'winning'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid transaction type'
      });
    }

    // Validate amount
    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0'
      });
    }

    // For withdrawals, check if user has sufficient balance but DON'T deduct yet
    if (type === 'withdrawal') {
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      if (user.wallet < amount) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient balance'
        });
      }
    }

    if (transactionId) {
      const existingTx = await Transaction.findOne({ transactionId });
      if (existingTx) {
        return res.status(400).json({
          success: false,
          message: `Transaction ID '${transactionId}' already exists`
        });
      }
    }

    // Create transaction with pending status
    const transaction = new Transaction({
      userId,
      type,
      amount,
      status: 'pending', // Both deposits and withdrawals start as pending
      reference,
      description: description || `${type} via ${reference}`,
      transactionId,
      senderPhone,
      senderName,
      receiverPhone,
      receiverName,
      method,
      metadata
    });

    const savedTransaction = await transaction.save();
    await savedTransaction.populate('userId', 'phone name');

    res.status(201).json({
      success: true,
      data: savedTransaction,
      message: 'Transaction created successfully'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Error creating transaction',
      error: error.message
    });
  }
});

// UPDATE deposit status and handle wallet update (admin only)
router.put('/deposit/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;
    
    const transaction = await Transaction.findById(id);
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    if (transaction.type !== 'deposit') {
      return res.status(400).json({
        success: false,
        message: 'This is not a deposit transaction'
      });
    }
    
    // Update transaction
    const updateData: any = { status };
    if (reason) updateData.reason = reason;
    
    const updatedTransaction = await Transaction.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    ).populate('userId', 'phone name');
    
    // If status is completed, update user wallet by adding the amount
    if (status === 'completed') {
      const user = await User.findById(transaction.userId);
      if (user) {
        user.wallet += transaction.amount;
        await user.save();
      }
    }
    
    res.json({
      success: true,
      data: updatedTransaction,
      message: 'Deposit transaction updated successfully'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Error updating deposit transaction',
      error: error.message
    });
  }
});

// UPDATE withdrawal status and handle wallet update (admin only)
router.put('/withdrawal/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, transactionId, reason } = req.body;
    
    const transaction = await Transaction.findById(id);
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    if (transaction.type !== 'withdrawal') {
      return res.status(400).json({
        success: false,
        message: 'This is not a withdrawal transaction'
      });
    }

      // Check for duplicate transactionId if updating
    if (transactionId) {
      const existingTx = await Transaction.findOne({
        transactionId,
        _id: { $ne: id } // exclude current transaction
      });
      if (existingTx) {
        return res.status(400).json({
          success: false,
          message: `Transaction ID '${transactionId}' already exists`
        });
      }
    }
    
    // Update transaction
    const updateData: any = { status };
    if (transactionId) updateData.transactionId = transactionId;
    if (reason) updateData.reason = reason;
    
    const updatedTransaction = await Transaction.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    ).populate('userId', 'phone name');
    
    // If status is completed, update user wallet by subtracting the amount
    if (status === 'completed') {
      const user = await User.findById(transaction.userId);
      if (user) {
        // Check if user still has sufficient balance
        if (user.wallet < transaction.amount) {
          return res.status(400).json({
            success: false,
            message: 'User no longer has sufficient balance for this withdrawal'
          });
        }
        
        user.wallet -= transaction.amount;
        await user.save();
      }
    }
    
    res.json({
      success: true,
      data: updatedTransaction,
      message: 'Withdrawal transaction updated successfully'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Error updating withdrawal transaction',
      error: error.message
    });
  }
});

export default router;