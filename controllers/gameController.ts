import { Request, Response } from 'express';
import Game from '../models/Game';
import BingoCard from '../models/BingoCard';
import User from '../models/User';
import Transaction from '../models/Transaction';
import { generateBingoCard, calculatePrize } from '../utils/gameLogic';
import { successResponse, errorResponse } from '../utils/helpers';

export const getGames = async (req: Request, res: Response) => {
  try {
    const { status, cardCount } = req.query;
    const filter: any = {};
    
    if (status) filter.status = status;
    if (cardCount) filter.cardCount = parseInt(cardCount as string);
    
    const games = await Game.find(filter)
      .sort({ startTime: -1 })
      .populate('winner', 'phone');
    
    successResponse(res, games, 'Games retrieved successfully');
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

export const getUserCards = async (req: Request, res: Response) => {
  try {
    const { id: gameId } = req.params;
    const userId = req.user!._id;
    
    const cards = await BingoCard.find({ gameId, userId });
    
    successResponse(res, cards, 'User cards retrieved successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

export const purchaseCard = async (req: Request, res: Response) => {
  try {
    const { id: gameId } = req.params;
    const userId = req.user!._id;
    
    // Check if game exists and is in waiting status
    const game = await Game.findById(gameId);
    if (!game) {
      return errorResponse(res, 'Game not found', 404);
    }
    
    if (game.status !== 'waiting') {
      return errorResponse(res, 'Cannot purchase cards for ongoing or completed games', 400);
    }
    
    // Check if user has already purchased maximum cards (2 per game)
    const userCardCount = await BingoCard.countDocuments({ gameId, userId });
    if (userCardCount >= 2) {
      return errorResponse(res, 'Maximum 2 cards allowed per game', 400);
    }
    
    // Check user balance
    const user = await User.findById(userId);
    if (!user || user.wallet < game.cardPrice) {
      return errorResponse(res, 'Insufficient balance', 400);
    }
    
    // Generate bingo card
    const cardNumbers = generateBingoCard();
    
    // Create bingo card
    const bingoCard = new BingoCard({
      gameId,
      userId,
      numbers: cardNumbers,
    });
    
    await bingoCard.save();
    
    // Deduct amount from user wallet
    user.wallet -= game.cardPrice;
    await user.save();
    
    // Create transaction record
    const transaction = new Transaction({
      userId,
      type: 'game_purchase',
      amount: game.cardPrice,
      status: 'completed',
      reference: `CARD-${Date.now()}-${userId}`,
      description: `Purchase of bingo card for game ${game.name}`,
      metadata: {
        gameId,
        cardId: bingoCard._id,
      }
    });
    
    await transaction.save();
    
    successResponse(res, bingoCard, 'Card purchased successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

export const getGameHistory = async (req: Request, res: Response) => {
  try {
    const userId = req.user!._id;
    
    const games = await Game.find({
      status: 'completed',
      startTime: { $lte: new Date() }
    })
    .sort({ startTime: -1 })
    .limit(20);
    
    successResponse(res, games, 'Game history retrieved successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};