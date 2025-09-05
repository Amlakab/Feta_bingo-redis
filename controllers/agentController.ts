import { Request, Response } from 'express';
import User from '../models/User';
import Game from '../models/Game';
import Transaction from '../models/Transaction';
import { successResponse, errorResponse } from '../utils/helpers';

export const getDashboard = async (req: Request, res: Response) => {
  try {
    // Get users registered by this agent (if agents can register users)
    const usersCount = await User.countDocuments();
    
    // Get active games
    const activeGames = await Game.countDocuments({ status: 'active' });
    
    // Get recent transactions
    const recentTransactions = await Transaction.find()
      .populate('userId', 'phone')
      .sort({ createdAt: -1 })
      .limit(10);
    
    successResponse(res, {
      usersCount,
      activeGames,
      recentTransactions
    }, 'Dashboard data retrieved successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

export const getUsers = async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    
    const users = await User.find({ role: 'user' })
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string))
      .skip((parseInt(page as string) - 1) * parseInt(limit as string));
    
    const total = await User.countDocuments({ role: 'user' });
    
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

export const getTransactions = async (req: Request, res: Response) => {
  try {
    const { type, page = 1, limit = 20 } = req.query;
    const filter: any = {};
    
    if (type) filter.type = type;
    
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