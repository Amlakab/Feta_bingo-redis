import express from 'express';
import Games from '../models/Games';
import { authenticate } from '../middleware/auth';

const router = express.Router();

// CREATE - Create a new game
router.post('/', authenticate, async (req, res) => {
  try {
    const { betAmount } = req.body;

    // Validate bet amount
    if (!betAmount || betAmount < 1 || betAmount > 10000) {
      return res.status(400).json({
        success: false,
        message: 'Invalid bet amount. Must be between 1 and 10000'
      });
    }

    const game = new Games({
      betAmount
    });

    await game.save();

    res.status(201).json({
      success: true,
      message: 'Game created successfully',
      data: game
    });
  } catch (error: any) {
    console.error('Error creating game:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating game',
      error: error.message
    });
  }
});

// READ - Get all games
router.get('/', authenticate, async (req, res) => {
  try {
    const games = await Games.find()
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      message: 'Games retrieved successfully',
      data: games
    });
  } catch (error: any) {
    console.error('Error fetching games:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching games',
      error: error.message
    });
  }
});

// READ - Get games by bet amount
router.get('/bet/:betAmount', authenticate, async (req, res) => {
  try {
    const { betAmount } = req.params;

    const games = await Games.find({ betAmount: parseInt(betAmount) })
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      message: 'Games retrieved successfully',
      data: games
    });
  } catch (error: any) {
    console.error('Error fetching games by bet amount:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching games',
      error: error.message
    });
  }
});

// READ - Get game by ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    const game = await Games.findById(req.params.id);

    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    res.json({
      success: true,
      message: 'Game retrieved successfully',
      data: game
    });
  } catch (error: any) {
    console.error('Error fetching game:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching game',
      error: error.message
    });
  }
});

// UPDATE - Update game by ID
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { betAmount } = req.body;

    // Validate bet amount if provided
    if (betAmount && (betAmount < 1 || betAmount > 10000)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid bet amount. Must be between 1 and 10000'
      });
    }

    const game = await Games.findByIdAndUpdate(
      req.params.id,
      { betAmount },
      { new: true, runValidators: true }
    );

    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    res.json({
      success: true,
      message: 'Game updated successfully',
      data: game
    });
  } catch (error: any) {
    console.error('Error updating game:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating game',
      error: error.message
    });
  }
});

// UPDATE - Update games by bet amount
router.put('/bet/:betAmount', authenticate, async (req, res) => {
  try {
    const { betAmount } = req.params;
    const { newBetAmount } = req.body;

    // Validate new bet amount
    if (!newBetAmount || newBetAmount < 1 || newBetAmount > 10000) {
      return res.status(400).json({
        success: false,
        message: 'Invalid new bet amount. Must be between 1 and 10000'
      });
    }

    const result = await Games.updateMany(
      { betAmount: parseInt(betAmount) },
      { betAmount: newBetAmount }
    );

    res.json({
      success: true,
      message: 'Games updated successfully',
      data: {
        modifiedCount: result.modifiedCount
      }
    });
  } catch (error: any) {
    console.error('Error updating games by bet amount:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating games',
      error: error.message
    });
  }
});

// DELETE - Delete game by ID
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const game = await Games.findByIdAndDelete(req.params.id);

    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    res.json({
      success: true,
      message: 'Game deleted successfully',
      data: game
    });
  } catch (error: any) {
    console.error('Error deleting game:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting game',
      error: error.message
    });
  }
});

// DELETE - Delete games by bet amount
router.delete('/bet/:betAmount', authenticate, async (req, res) => {
  try {
    const { betAmount } = req.params;

    const result = await Games.deleteMany({ betAmount: parseInt(betAmount) });

    res.json({
      success: true,
      message: 'Games deleted successfully',
      data: {
        deletedCount: result.deletedCount
      }
    });
  } catch (error: any) {
    console.error('Error deleting games by bet amount:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting games',
      error: error.message
    });
  }
});

// DELETE - Delete all games
router.delete('/', authenticate, async (req, res) => {
  try {
    const result = await Games.deleteMany({});

    res.json({
      success: true,
      message: 'All games deleted successfully',
      data: {
        deletedCount: result.deletedCount
      }
    });
  } catch (error: any) {
    console.error('Error deleting all games:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting games',
      error: error.message
    });
  }
});

export default router;