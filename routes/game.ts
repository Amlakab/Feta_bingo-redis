import express, { Request, Response } from 'express';
import GameSession from '../models/GameSession';
import GameHistory from '../models/GameHistory';
import User from '../models/User';
import { authenticate } from '../middleware/auth';

const router = express.Router();

// Create game session
router.post('/session', authenticate, async (req: Request, res: Response) => {
  try {
    console.log('Creating game session - User:', req.user);
    console.log('Request body:', req.body);

    const { cardNumber, betAmount, createdAt } = req.body;
    
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    // Check if card is already taken for this bet amount
    const existingSession = await GameSession.findOne({ 
      cardNumber, 
      betAmount,
      status: { $in: ['active', 'playing'] as const }
    });
    
    if (existingSession) {
      return res.status(400).json({ error: 'Card already taken' });
    }
    
    // Check user wallet balance
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (user.wallet < betAmount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    
    // Deduct bet amount from wallet
    user.wallet -= betAmount;
    await user.save();
    
    // Create game session with the provided createdAt time or current time
    const gameSession = new GameSession({
      userId: req.user._id,
      cardNumber,
      betAmount,
      status: 'active',
      createdAt: createdAt ? new Date(createdAt) : new Date() // Use provided time or current time
    });
    
    await gameSession.save();
    
    console.log('Game session created successfully:', gameSession);
    res.json(gameSession);
  } catch (error: any) {
    console.error('Error creating game session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all game sessions
router.get('/sessions', async (req: Request, res: Response) => {
  try {
    const sessions = await GameSession.find().populate('userId', 'phone');
    res.json(sessions);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get game sessions by bet amount
router.get('/sessions/bet/:amount', async (req: Request, res: Response) => {
  try {
    const amount = parseInt(req.params.amount);
    const sessions = await GameSession.find({ 
      betAmount: amount,
      status: { $in: ['active', 'playing'] as const }
    }).populate('userId', 'phone');
    res.json(sessions);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get game session by card number
router.get('/sessions/card/:cardNumber', async (req: Request, res: Response) => {
  try {
    const cardNumber = parseInt(req.params.cardNumber);
    const session = await GameSession.findOne({ 
      cardNumber
    }).populate('userId', 'phone');
    res.json(session);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get game sessions by user ID
router.get('/sessions/user/:userId', async (req: Request, res: Response) => {
  try {
    const sessions = await GameSession.find({ 
      userId: req.params.userId
    }).populate('userId', 'phone');
    res.json(sessions);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update game session status
router.put('/session/:id/status', async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    const session = await GameSession.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    res.json(session);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete game session by card number and refund user
router.delete('/sessions/card/:cardNumber', authenticate, async (req: Request, res: Response) => {
  try {
    const cardNumber = parseInt(req.params.cardNumber);
    
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    // Find the game session for this card
    const session = await GameSession.findOne({ 
      cardNumber,
      userId: req.user._id,
      status: 'active'
    });
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found or not owned by user' });
    }
    
    // Refund the bet amount to user's wallet
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    user.wallet += session.betAmount;
    await user.save();
    
    // Delete the game session
    await GameSession.findOneAndDelete({ 
      cardNumber,
      userId: req.user._id
    });
    
    res.json({ 
      message: 'Session deleted and refund processed',
      refundAmount: session.betAmount,
      newWalletBalance: user.wallet
    });
  } catch (error: any) {
    console.error('Error deleting game session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete game sessions by user ID
router.delete('/sessions/user/:userId', async (req: Request, res: Response) => {
  try {
    await GameSession.deleteMany({ userId: req.params.userId });
    res.json({ message: 'Sessions deleted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete game sessions by bet amount
router.delete('/sessions/bet/:amount', async (req: Request, res: Response) => {
  try {
    const amount = parseInt(req.params.amount);
    await GameSession.deleteMany({ betAmount: amount });
    res.json({ message: 'Sessions deleted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get all game history
router.get('/history', async (req: Request, res: Response) => {
  try {
    const history = await GameHistory.find().populate('winnerId', 'phone');
    res.json(history);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get latest game history by bet amount
router.get('/history/latest/:betAmount', async (req: Request, res: Response) => {
  try {
    const betAmount = parseInt(req.params.betAmount);

    const latestHistory = await GameHistory.findOne({ betAmount })
      .sort({ createdAt: -1 }) // sort by newest first
      .populate('winnerId', 'phone');

    if (!latestHistory) {
      return res.status(404).json({ error: 'No history found for this bet amount' });
    }

    res.json(latestHistory);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});


// Get game history by bet amount
router.get('/history/bet/:amount', async (req: Request, res: Response) => {
  try {
    const amount = parseInt(req.params.amount);
    const history = await GameHistory.find({ 
      betAmount: amount
    }).populate('winnerId', 'phone');
    res.json(history);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get game history by id
router.get('/history/:id', async (req: Request, res: Response) => {
  try {
    const history = await GameHistory.findById(req.params.id).populate('winnerId', 'phone');
    res.json(history);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get game history by user ID (as winner)
router.get('/history/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const history = await GameHistory.find({ winnerId: userId })
      .populate('winnerId', 'phone')
      .sort({ createdAt: -1 }); // newest first
    
    if (!history || history.length === 0) {
      return res.status(404).json({ error: 'No history found for this user' });
    }

    res.json(history);
  } catch (error: any) {
    console.error('Error fetching game history by user:', error);
    res.status(500).json({ error: error.message });
  }
});


// Create game history
router.post('/history', async (req: Request, res: Response) => {
  try {
    const { winnerId, winnerCard, prizePool, numberOfPlayers, betAmount } = req.body;
    
    const gameHistory = new GameHistory({
      winnerId,
      winnerCard,
      prizePool,
      numberOfPlayers,
      betAmount
    });
    
    await gameHistory.save();
    
    // Update winner's wallet and earnings
    const winner = await User.findById(winnerId);
    if (winner) {
      winner.wallet += prizePool;
      winner.dailyEarnings = (winner.dailyEarnings || 0) + prizePool;
      winner.weeklyEarnings = (winner.weeklyEarnings || 0) + prizePool;
      winner.totalEarnings = (winner.totalEarnings || 0) + prizePool;
      await winner.save();
    }
    
    res.json(gameHistory);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete game history by bet amount
router.delete('/history/bet/:amount', async (req: Request, res: Response) => {
  try {
    const amount = parseInt(req.params.amount);
    await GameHistory.deleteMany({ betAmount: amount });
    res.json({ message: 'History deleted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update user wallet
router.put('/user/:userId/wallet', async (req: Request, res: Response) => {
  try {
    const { amount } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { wallet: amount },
      { new: true }
    );
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get user by ID
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.params.userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;