import { Request, Response } from 'express';
import mongoose from 'mongoose';
import User, { IUser } from '../models/User';
import Transaction from '../models/Transaction';
import GameHistory from '../models/GameHistory';
import SpinnerHistory from '../models/SpinnerHistory';
// Helper functions
const successResponse = (res: Response, data: any, message: string = 'Success', statusCode: number = 200) => {
  res.status(statusCode).json({
    success: true,
    message,
    data
  });
};

const errorResponse = (res: Response, message: string = 'Error', statusCode: number = 500) => {
  res.status(statusCode).json({
    success: false,
    message
  });
};

// Get all users with pagination and filtering
export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = req.query.search as string || '';
    const role = req.query.role as string || '';
    const status = req.query.status as string || '';

    const skip = (page - 1) * limit;

    // Build filter object
    const filter: any = {};
    
    if (search) {
      filter.phone = { $regex: search, $options: 'i' };
    }
    
    if (role) {
      filter.role = role;
    }
    
    if (status) {
      filter.isActive = status === 'active';
    }

    const users = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalUsers = await User.countDocuments(filter);
    const totalPages = Math.ceil(totalUsers / limit);

    successResponse(res, {
      users,
      pagination: {
        currentPage: page,
        totalPages,
        totalUsers,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    }, 'Users retrieved successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

// Create new user
export const createUser = async (req: Request, res: Response) => {
  try {
    const { phone, password, role, wallet } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ phone });
    if (existingUser) {
      return errorResponse(res, 'User with this phone number already exists', 400);
    }

    const newUser = new User({
      phone,
      password,
      role: role || 'user',
      wallet: wallet || 0,
      dailyEarnings: 0,
      weeklyEarnings: 0,
      totalEarnings: 0,
      isActive: true
    });

    await newUser.save();

    // Return user without password
    const userResponse = await User.findById(newUser._id).select('-password');
    
    successResponse(res, userResponse, 'User created successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

// Update user status (block/unblock)
export const updateUserStatus = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return errorResponse(res, 'isActive must be a boolean value', 400);
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { isActive },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    successResponse(res, user, `User ${isActive ? 'activated' : 'blocked'} successfully`);
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

// Delete user with all related data
export const deleteUser = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return errorResponse(res, 'Invalid user ID', 400);
    }

    console.log(`Starting deletion process for user: ${userId}`);

    // Find the user first to check their role
    const user = await User.findById(userId).session(session);
    
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    session.startTransaction();

    // Delete all transactions related to the user
    const transactionResult = await Transaction.deleteMany({ 
      userId: user._id 
    }).session(session);
    console.log(`Deleted ${transactionResult.deletedCount} transactions for user ${userId}`);

    let gameHistoryResult: any = null;
    let spinnerHistoryResult: any = null;

    // Delete game history based on user role
    if (user.role === 'spinner-user') {
      // Delete from SpinnerHistory for spinner users
      spinnerHistoryResult = await SpinnerHistory.deleteMany({ 
        winnerId: user._id 
      }).session(session);
      console.log(`Deleted ${spinnerHistoryResult.deletedCount} spinner history records for user ${userId}`);
    } else {
      // Delete from GameHistory for regular users, disk-users, agents, admins
      gameHistoryResult = await GameHistory.deleteMany({ 
        winnerId: user._id 
      }).session(session);
      console.log(`Deleted ${gameHistoryResult.deletedCount} game history records for user ${userId}`);
    }

    // Delete the user
    await User.findByIdAndDelete(user._id).session(session);
    console.log(`User ${userId} deleted successfully`);

    // Commit the transaction
    await session.commitTransaction();
    
    // Prepare response data
    const deletionSummary = {
      transactionsDeleted: transactionResult.deletedCount,
      gameHistoryDeleted: gameHistoryResult?.deletedCount || 0,
      spinnerHistoryDeleted: spinnerHistoryResult?.deletedCount || 0,
      userRole: user.role
    };

    successResponse(res, deletionSummary, 'User and all related data deleted successfully');
    
  } catch (error: any) {
    // If anything fails, abort the transaction
    await session.abortTransaction();
    console.error('Error deleting user and related data:', error);
    errorResponse(res, `Failed to delete user: ${error.message}`, 500);
  } finally {
    session.endSession();
  }
};


// Get user statistics
export const getUserStatistics = async (req: Request, res: Response) => {
  try {
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ isActive: true });
    const blockedUsers = await User.countDocuments({ isActive: false });
    
    const userRoles = await User.aggregate([
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 }
        }
      }
    ]);

    const totalWalletBalance = await User.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: '$wallet' }
        }
      }
    ]);

    const totalEarnings = await User.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: '$totalEarnings' }
        }
      }
    ]);

    successResponse(res, {
      totalUsers,
      activeUsers,
      blockedUsers,
      roles: userRoles,
      totalWalletBalance: totalWalletBalance[0]?.total || 0,
      totalEarnings: totalEarnings[0]?.total || 0
    }, 'Statistics retrieved successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

// Get single user
export const getUser = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findById(userId).select('-password');
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    successResponse(res, user, 'User retrieved successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

// Change user password
export const changePassword = async (req: Request, res: Response) => {
  try {
    const { userId, currentPassword, newPassword } = req.body;
    
    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }
    
    // Verify current password
    const isPasswordValid = await user.comparePassword(currentPassword);
    if (!isPasswordValid) {
      return errorResponse(res, 'Current password is incorrect', 400);
    }
    
    // Update password
    user.password = newPassword;
    await user.save();
    
    successResponse(res, null, 'Password changed successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

// Update wallet
export const updateWallet = async (req: Request, res: Response) => {
  try {
    const { userId, amount } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    // Check if the user has sufficient balance if amount is negative
    if (amount < 0 && user.wallet < Math.abs(amount)) {
      return errorResponse(res, 'Insufficient wallet balance', 400);
    }

    user.wallet += amount;
    await user.save();

    successResponse(res, { wallet: user.wallet }, 'Wallet updated successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

// Set user wallet to a specific value
export const setWallet = async (req: Request, res: Response) => {
  try {
    const { userId, amount } = req.body;

    if (typeof amount !== 'number' || amount < 0) {
      return errorResponse(res, 'Amount must be a non-negative number', 400);
    }

    const user = await User.findById(userId);
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    user.wallet = amount;
    await user.save();

    successResponse(res, { wallet: user.wallet }, 'Wallet updated successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

export const minusWallet = async (req: Request, res: Response) => {
  try {
    const { userId, amount } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    // Get current date and reset daily/weekly earnings if needed
    const now = new Date();
    const lastUpdated = new Date(user.updatedAt);
    
    // Reset daily earnings if it's a new day
    if (lastUpdated.getDate() !== now.getDate()) {
      user.dailyEarnings = 0;
    }
    
    // Reset weekly earnings if it's a new week
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const lastUpdateStartOfWeek = new Date(lastUpdated);
    lastUpdateStartOfWeek.setDate(lastUpdated.getDate() - lastUpdated.getDay());
    
    if (startOfWeek.getTime() !== lastUpdateStartOfWeek.getTime()) {
      user.weeklyEarnings = 0;
    }

    // Update earnings
    user.dailyEarnings += amount;
    user.weeklyEarnings += amount;
    user.totalEarnings += amount;
    user.wallet -= amount;
    
    await user.save();

    successResponse(res, { 
      wallet: user.wallet,
      dailyEarnings: user.dailyEarnings,
      weeklyEarnings: user.weeklyEarnings,
      totalEarnings: user.totalEarnings
    }, 'Earnings updated successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

// Update earnings
export const updateEarnings = async (req: Request, res: Response) => {
  try {
    const { userId, amount } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    // Get current date and reset daily/weekly earnings if needed
    const now = new Date();
    const lastUpdated = new Date(user.updatedAt);
    
    // Reset daily earnings if it's a new day
    if (lastUpdated.getDate() !== now.getDate()) {
      user.dailyEarnings = 0;
    }
    
    // Reset weekly earnings if it's a new week
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const lastUpdateStartOfWeek = new Date(lastUpdated);
    lastUpdateStartOfWeek.setDate(lastUpdated.getDate() - lastUpdated.getDay());
    
    if (startOfWeek.getTime() !== lastUpdateStartOfWeek.getTime()) {
      user.weeklyEarnings = 0;
    }

    // Update earnings
    user.dailyEarnings += amount;
    user.weeklyEarnings += amount;
    user.totalEarnings += amount;
    user.wallet += amount;
    
    await user.save();

    successResponse(res, { 
      wallet: user.wallet,
      dailyEarnings: user.dailyEarnings,
      weeklyEarnings: user.weeklyEarnings,
      totalEarnings: user.totalEarnings
    }, 'Earnings updated successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};