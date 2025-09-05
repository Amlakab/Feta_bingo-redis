import { Request, Response } from 'express';
import User from '../models/User';
import Game from '../models/Game';
import Transaction from '../models/Transaction';
import { successResponse, errorResponse } from '../utils/helpers';

export const getUsers = async (req: Request, res: Response) => {
  try {
    const { role, isActive, page = 1, limit = 20 } = req.query;
    const filter: any = {};
    
    if (role) filter.role = role;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    
    const users = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string))
      .skip((parseInt(page as string) - 1) * parseInt(limit as string));
    
    const total = await User.countDocuments(filter);
    
    successResponse(res, {
      users,
      total,
      page: parseInt(page as string),
      pages: Math.ceil(total / parseInt(limit as string))
    }, 'Users retrieved successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

export const getUser = async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }
    
    successResponse(res, user, 'User retrieved successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

export const updateUser = async (req: Request, res: Response) => {
  try {
    const { role, isActive, wallet } = req.body;
    
    const user = await User.findById(req.params.id);
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }
    
    if (role) user.role = role;
    if (isActive !== undefined) user.isActive = isActive;
    if (wallet !== undefined) user.wallet = wallet;
    
    await user.save();
    
    successResponse(res, user, 'User updated successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

export const getGames = async (req: Request, res: Response) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter: any = {};
    
    if (status) filter.status = status;
    
    const games = await Game.find(filter)
      .populate('winner', 'phone')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string))
      .skip((parseInt(page as string) - 1) * parseInt(limit as string));
    
    const total = await Game.countDocuments(filter);
    
    successResponse(res, {
      games,
      total,
      page: parseInt(page as string),
      pages: Math.ceil(total / parseInt(limit as string))
    }, 'Games retrieved successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

export const getGame = async (req: Request, res: Response) => {
  try {
    const game = await Game.findById(req.params.id)
      .populate('winner', 'phone');
    
    if (!game) {
      return errorResponse(res, 'Game not found', 404);
    }
    
    successResponse(res, game, 'Game retrieved successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

export const createGame = async (req: Request, res: Response) => {
  try {
    const { name, cardCount, cardPrice, startTime } = req.body;
    
    const game = new Game({
      name,
      cardCount,
      cardPrice,
      startTime: new Date(startTime),
    });
    
    await game.save();
    
    successResponse(res, game, 'Game created successfully', 201);
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

export const updateGame = async (req: Request, res: Response) => {
  try {
    const { status, winner } = req.body;
    
    const game = await Game.findById(req.params.id);
    if (!game) {
      return errorResponse(res, 'Game not found', 404);
    }
    
    if (status) game.status = status;
    if (winner) game.winner = winner;
    
    if (status === 'completed' && !game.endTime) {
      game.endTime = new Date();
    }
    
    await game.save();
    
    successResponse(res, game, 'Game updated successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

export const getTransactions = async (req: Request, res: Response) => {
  try {
    const { type, status, page = 1, limit = 20 } = req.query;
    const filter: any = {};
    
    if (type) filter.type = type;
    if (status) filter.status = status;
    
    const transactions = await Transaction.find(filter)
      .populate('userId', 'phone')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string))
      .skip((parseInt(page as string) - 1) * parseInt(limit as string));
    
    const total = await Transaction.countDocuments(filter);
    
    successResponse(res, {
      transactions,
      total,
      page: parseInt(page as string),
      pages: Math.ceil(total / parseInt(limit as string))
    }, 'Transactions retrieved successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

export const updateTransaction = async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    
    const transaction = await Transaction.findById(req.params.id);
    if (!transaction) {
      return errorResponse(res, 'Transaction not found', 404);
    }
    
    if (status) transaction.status = status;
    
    // If withdrawal is rejected, return funds to user
    if (transaction.type === 'withdrawal' && status === 'failed' && transaction.status === 'pending') {
      const user = await User.findById(transaction.userId);
      if (user) {
        user.wallet += transaction.amount;
        await user.save();
      }
    }
    
    await transaction.save();
    
    successResponse(res, transaction, 'Transaction updated successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

export const getAnalytics = async (req: Request, res: Response) => {
  try {
    // Get total users count
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ isActive: true });
    
    // Get total games count
    const totalGames = await Game.countDocuments();
    const activeGames = await Game.countDocuments({ status: 'active' });
    
    // Get revenue data
    const revenueData = await Transaction.aggregate([
      {
        $match: {
          type: 'game_purchase',
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$amount' }
        }
      }
    ]);
    
    const totalRevenue = revenueData[0]?.totalRevenue || 0;
    
    // Get payout data
    const payoutData = await Transaction.aggregate([
      {
        $match: {
          type: 'winning',
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          totalPayouts: { $sum: '$amount' }
        }
      }
    ]);
    
    const totalPayouts = payoutData[0]?.totalPayouts || 0;
    
    // Get recent transactions
    const recentTransactions = await Transaction.find()
      .populate('userId', 'phone')
      .sort({ createdAt: -1 })
      .limit(10);
    
    successResponse(res, {
      users: {
        total: totalUsers,
        active: activeUsers
      },
      games: {
        total: totalGames,
        active: activeGames
      },
      financials: {
        revenue: totalRevenue,
        payouts: totalPayouts,
        profit: totalRevenue - totalPayouts
      },
      recentTransactions
    }, 'Analytics retrieved successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};