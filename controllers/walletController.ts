import { Request, Response } from 'express';
import User from '../models/User';
import Transaction from '../models/Transaction';
import { chapa, generateTxRef } from '../config/chapa';
import { successResponse, errorResponse } from '../utils/helpers';

/**
 * Get user wallet info
 */
export const getWallet = async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.user!._id).select('wallet dailyEarnings weeklyEarnings totalEarnings');
    if (!user) return errorResponse(res, 'User not found', 404);

    successResponse(res, user, 'Wallet retrieved successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

/**
 * Get user transactions
 */
export const getTransactions = async (req: Request, res: Response) => {
  try {
    const { type, limit = 20, page = 1 } = req.query;
    const filter: any = { userId: req.user!._id };
    if (type) filter.type = type;

    const transactions = await Transaction.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string))
      .skip((parseInt(page as string) - 1) * parseInt(limit as string));

    const total = await Transaction.countDocuments(filter);

    successResponse(res, {
      transactions,
      total,
      page: parseInt(page as string),
      pages: Math.ceil(total / parseInt(limit as string)),
    }, 'Transactions retrieved successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

/**
 * Initialize deposit with Chapa
 */
export const initializeDeposit = async (req: Request, res: Response) => {
  try {
    const { amount, currency = 'ETB', method = 'card' } = req.body;
    const userId = req.user!._id;

    const user = await User.findById(userId);
    if (!user) return errorResponse(res, 'User not found', 404);

    const tx_ref = generateTxRef(userId.toString(), 'deposit');

    // Base payment options
    let paymentOptions: any = {
      amount: amount.toString(),
      currency,
      email: `${user.phone}@bingo.com`,
      first_name: 'User',
      last_name: user.phone,
      tx_ref,
      callback_url: `${process.env.CLIENT_URL}/wallet?success=true`,
      return_url: `${process.env.CLIENT_URL}/wallet`,
      customization: {
        title: 'Bingo Platform Deposit',
        description: `Deposit of ${amount} ${currency}`,
      },
    };

    // Add phone_number and payment_type for mobile methods
    if (method === 'telebirr' || method === 'cbe') {
      paymentOptions.phone_number = user.phone;
      paymentOptions.payment_type = method;
    }

    const response: any = await chapa.initialize(paymentOptions);

    // Save pending transaction
    const transaction = new Transaction({
      userId,
      type: 'deposit',
      amount,
      status: 'pending',
      reference: tx_ref,
      description: `Deposit of ${amount} ${currency}`,
      metadata: { method }
    });
    await transaction.save();

    successResponse(res, { checkout_url: response?.data?.checkout_url || null }, 'Deposit initialized successfully');
  } catch (error: any) {
    console.error('Deposit error:', error);
    errorResponse(res, error.message, 500);
  }
};

/**
 * Verify deposit after payment
 */
export const verifyDeposit = async (req: Request, res: Response) => {
  try {
    const { tx_ref } = req.params;
    const response: any = await chapa.verify(tx_ref);

    if (response?.status === 'success') {
      const transaction = await Transaction.findOne({ reference: tx_ref });
      if (transaction && transaction.status === 'pending') {
        transaction.status = 'completed';
        await transaction.save();

        const user = await User.findById(transaction.userId);
        if (user) {
          user.wallet += transaction.amount;
          await user.save();
        }
      }

      successResponse(res, { status: 'success' }, 'Deposit verified successfully');
    } else {
      errorResponse(res, 'Deposit verification failed', 400);
    }
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

/**
 * Handle Chapa webhook (automatic deposit verification)
 */
export const handleWebhook = async (req: Request, res: Response) => {
  try {
    const { tx_ref, status } = req.body;

    if (status === 'success') {
      const transaction = await Transaction.findOne({ reference: tx_ref });
      if (transaction && transaction.status === 'pending') {
        transaction.status = 'completed';
        await transaction.save();

        const user = await User.findById(transaction.userId);
        if (user) {
          user.wallet += transaction.amount;
          await user.save();
        }
      }
    }

    res.status(200).send('Webhook received');
  } catch (error: any) {
    console.error('Webhook error:', error);
    res.status(500).send('Webhook processing failed');
  }
};

/**
 * Request withdrawal
 */
export const requestWithdrawal = async (req: Request, res: Response) => {
  try {
    const { amount, accountNumber, bankName, method = 'bank' } = req.body;
    const userId = req.user!._id;

    const user = await User.findById(userId);
    if (!user) return errorResponse(res, 'User not found', 404);
    if (user.wallet < amount) return errorResponse(res, 'Insufficient balance', 400);
    if (amount < 50) return errorResponse(res, 'Minimum withdrawal amount is 50 ETB', 400);

    const transaction = new Transaction({
      userId,
      type: 'withdrawal',
      amount,
      status: 'pending',
      reference: `WTH-${Date.now()}-${userId}`,
      description: `Withdrawal request to ${bankName || 'Mobile'} account ${accountNumber}`,
      metadata: { accountNumber, bankName, method }
    });
    await transaction.save();

    // Reserve funds
    user.wallet -= amount;
    await user.save();

    successResponse(res, transaction, 'Withdrawal request submitted successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

/**
 * Get user winnings (completed transactions of type 'winning')
 */
export const getWinnings = async (req: Request, res: Response) => {
  try {
    const userId = req.user!._id;

    const winnings = await Transaction.find({
      userId,
      type: 'winning',
      status: 'completed',
    }).sort({ createdAt: -1 }).limit(20);

    successResponse(res, winnings, 'Winnings retrieved successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};