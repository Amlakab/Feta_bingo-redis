// routes/spinner.ts
import express, { Request, Response } from 'express';
import SpinnerHistory from '../models/SpinnerHistory';
import GameSession from '../models/GameSession';
import User from '../models/User';
import { authenticate } from '../middleware/auth';

const router = express.Router();

// Create spinner game session
router.post('/session', authenticate, async (req: Request, res: Response) => {
  try {
    console.log('Creating spinner game session - User:', req.user);
    console.log('Request body:', req.body);

    const { selectedNumbers, betAmount, numberOfPlayers, createdAt } = req.body;
    
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    // Check user wallet balance
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const totalBetAmount = betAmount * selectedNumbers.length;
    
    if (user.wallet < totalBetAmount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    
    // Deduct total bet amount from wallet
    user.wallet -= totalBetAmount;
    await user.save();
    
    // Create game sessions for each selected number
    const gameSessions = [];
    for (const cardNumber of selectedNumbers) {
      // Check if card is already taken for this bet amount
      const existingSession = await GameSession.findOne({ 
        cardNumber, 
        betAmount,
        status: { $in: ['active', 'playing'] as const }
      });
      
      if (existingSession) {
        // Refund already deducted amount for previous cards
        user.wallet += betAmount * gameSessions.length;
        await user.save();
        return res.status(400).json({ error: `Card ${cardNumber} already taken` });
      }
      
      const gameSession = new GameSession({
        userId: req.user._id,
        cardNumber,
        betAmount,
        status: 'active',
        gameType: 'spinner',
        createdAt: createdAt ? new Date(createdAt) : new Date()
      });
      
      await gameSession.save();
      gameSessions.push(gameSession);
    }
    
    console.log('Spinner game sessions created successfully:', gameSessions);
    res.json({
      sessions: gameSessions,
      totalBetAmount,
      newWalletBalance: user.wallet
    });
  } catch (error: any) {
    console.error('Error creating spinner game session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get spinner game sessions by bet amount
router.get('/sessions/bet/:amount', async (req: Request, res: Response) => {
  try {
    const amount = parseInt(req.params.amount);
    const sessions = await GameSession.find({ 
      betAmount: amount,
      gameType: 'spinner',
      status: { $in: ['active', 'playing'] as const }
    }).populate('userId', 'phone');
    res.json(sessions);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete spinner game sessions and refund
router.delete('/sessions', authenticate, async (req: Request, res: Response) => {
  try {
    const { selectedNumbers, betAmount } = req.body;
    
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    // Find and delete the game sessions
    const deletedSessions = await GameSession.find({
      userId: req.user._id,
      cardNumber: { $in: selectedNumbers },
      betAmount: betAmount,
      status: 'active',
      gameType: 'spinner'
    });
    
    if (deletedSessions.length === 0) {
      return res.status(404).json({ error: 'No active spinner sessions found' });
    }
    
    // Refund the total bet amount to user's wallet
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const totalRefundAmount = betAmount * deletedSessions.length;
    user.wallet += totalRefundAmount;
    await user.save();
    
    // Delete the game sessions
    await GameSession.deleteMany({
      userId: req.user._id,
      cardNumber: { $in: selectedNumbers },
      betAmount: betAmount,
      gameType: 'spinner'
    });
    
    res.json({ 
      message: 'Spinner sessions deleted and refund processed',
      refundAmount: totalRefundAmount,
      newWalletBalance: user.wallet,
      deletedSessions: deletedSessions.length
    });
  } catch (error: any) {
    console.error('Error deleting spinner game sessions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create spinner game history
router.post('/history', authenticate, async (req: Request, res: Response) => {
  try {
    const { winnerNumber, prizePool, numberOfPlayers, betAmount, selectedNumbers } = req.body;
    
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    const spinnerHistory = new SpinnerHistory({
      winnerId: req.user._id,
      winnerNumber,
      prizePool,
      numberOfPlayers,
      betAmount,
      selectedNumbers
    });
    
    await spinnerHistory.save();
    
    // Update winner's wallet with prize pool
    const winner = await User.findById(req.user._id);
    if (winner) {
      winner.wallet += prizePool;
      winner.dailyEarnings = (winner.dailyEarnings || 0) + prizePool;
      winner.weeklyEarnings = (winner.weeklyEarnings || 0) + prizePool;
      winner.totalEarnings = (winner.totalEarnings || 0) + prizePool;
      await winner.save();
    }
    
    // Clean up game sessions for this round
    await GameSession.deleteMany({
      betAmount: betAmount,
      gameType: 'spinner',
      status: 'active'
    });
    
    res.json(spinnerHistory);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get all spinner history
router.get('/history', async (req: Request, res: Response) => {
  try {
    const history = await SpinnerHistory.find()
      .populate('winnerId', 'phone')
      .sort({ createdAt: -1 });
    res.json(history);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get spinner history by user ID
router.get('/history/user/:userId', async (req: Request, res: Response) => {
  try {
    const history = await SpinnerHistory.find({ winnerId: req.params.userId })
      .populate('winnerId', 'phone')
      .sort({ createdAt: -1 });
    res.json(history);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get spinner history by bet amount
router.get('/spinner/history/bet/:amount', async (req: Request, res: Response) => {
  try {
    const amount = parseInt(req.params.amount);
    const history = await SpinnerHistory.find({ betAmount: amount })
      .populate('winnerId', 'phone')
      .sort({ createdAt: -1 });
    res.json(history);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;