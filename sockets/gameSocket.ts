// =============================
// File: src/socket/setupSocket.ts (MongoDB GameSession version) - CORRECTED
// =============================
import { Server, Socket } from 'socket.io';
import mongoose from 'mongoose';
import User from '../models/User';
import GameSession, { IGameSession } from '../models/GameSession';

interface AuthenticatedSocket extends Socket { userId?: string; }

// ---- Bingo calling logic ----
interface GameState {
  betAmount: number;
  calledNumbers: string[];
  remainingNumbers: string[];
  isCalling: boolean;
  gameEnded: boolean;
  callingInterval?: NodeJS.Timeout;
}

const activeGames = new Map<number, GameState>();
const pendingWinners: Record<number, { userId: string; card: number }[]> = {};

function generateAllBingoNumbers(): string[] {
  const letters = ["B","I","N","G","O"];
  const ranges = [
    {min:1,max:15},{min:16,max:30},
    {min:31,max:45},{min:46,max:60},
    {min:61,max:75}
  ];
  const all: string[] = [];
  letters.forEach((l,i)=>{ 
    for(let n=ranges[i].min;n<=ranges[i].max;n++){ 
      all.push(`${l}-${n}`);
    } 
  });
  return all;
}

function shuffleNumbers(numbers: string[]): string[] {
  const a=[...numbers];
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

function startGameCalling(io: Server, betAmount: number) {
  // Clear any existing interval for this bet amount
  if (activeGames.has(betAmount)) {
    const existingGame = activeGames.get(betAmount)!;
    if (existingGame.callingInterval) {
      clearInterval(existingGame.callingInterval);
    }
  }
  
  const all = generateAllBingoNumbers();
  const shuffled = shuffleNumbers(all);
  const gameState: GameState = { 
    betAmount, 
    calledNumbers: [], 
    remainingNumbers: shuffled, 
    isCalling: true,
    gameEnded: false
  };
  
  activeGames.set(betAmount, gameState);

  gameState.callingInterval = setInterval(() => {
    const game = activeGames.get(betAmount);
    if (!game || game.remainingNumbers.length === 0 || game.gameEnded) {
      stopGameCalling(betAmount);
      return;
    }
    
    const nextNumber = game.remainingNumbers[0];
    game.calledNumbers.push(nextNumber);
    game.remainingNumbers = game.remainingNumbers.slice(1);
    
    // Emit to all clients
    io.emit('number-called', { 
      betAmount, 
      number: nextNumber, 
      calledNumbers: game.calledNumbers 
    });
    
    if (game.remainingNumbers.length === 0) {
      stopGameCalling(betAmount);
    }
  }, 4000);
}

function stopGameCalling(betAmount: number) {
  const game = activeGames.get(betAmount);
  if (game && game.callingInterval) { 
    clearInterval(game.callingInterval); 
    game.isCalling = false;
    game.gameEnded = true;
  }
}

function getGameState(betAmount: number) { 
  return activeGames.get(betAmount); 
}

// Helper: attach user phones
async function enrichWithUserPhones(sessions: IGameSession[]) {
  const uniqueUserIds = Array.from(new Set(sessions.map(s => String(s.userId))));
  const users = await User.find({ _id: { $in: uniqueUserIds } }).select('phone');
  const phoneMap = new Map<string, string>();
  users.forEach(u => { phoneMap.set(String(u._id), (u as any).phone); });
  return sessions.map(s => ({
    ...s.toObject(),
    userId: { _id: s.userId, phone: phoneMap.get(String(s.userId)) || null }
  }));
}

export function setupSocket(io: Server) {
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = (socket.handshake as any).auth?.token || (socket.handshake.query as any).token;
      if (!token) return next(new Error('Authentication error'));
      socket.userId = socket.handshake.query.userId as string;
      next();
    } catch { next(new Error('Authentication error')); }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log('Client connected:', socket.id, 'User:', socket.userId);

    // === Fetch sessions ===
    socket.on('get-sessions', async (data: { betOptions?: number[]; betAmount?: number }) => {
      try {
        const betAmountIn = data.betOptions && data.betOptions.length
          ? data.betOptions
          : (data.betAmount !== undefined ? [data.betAmount] : undefined);

        const filter: any = { status: { $in: ['ready','active','playing','blocked'] } };
        if (betAmountIn) filter.betAmount = { $in: betAmountIn };

        const sessions = await GameSession.find(filter);
        const enriched = await enrichWithUserPhones(sessions);
        socket.emit('sessions-updated', enriched);
      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to get sessions' });
      }
    });

    // === Create session ===
    socket.on('create-session', async (data: { userId: string; cardNumber: number; betAmount: number; createdAt?: string }) => {
      try {
        const { userId, cardNumber, betAmount, createdAt } = data;
        if (userId !== socket.userId) return socket.emit('error', { message: 'Unauthorized' });

        const existing = await GameSession.findOne({
          cardNumber, betAmount, status: { $in: ['ready','active','playing'] }
        });
        if (existing) return socket.emit('error', { message: 'Card already taken' });

        const created = await GameSession.create({
          userId: new mongoose.Types.ObjectId(userId),
          cardNumber, betAmount, status: 'active', createdAt
        });

        const populatedCreated = (await enrichWithUserPhones([created]))[0];
        const allSessions = await GameSession.find({ status: { $in: ['ready','active','playing'] } });
        const enrichedAll = await enrichWithUserPhones(allSessions);

        io.emit('session-created', populatedCreated);
        io.emit('sessions-updated', enrichedAll);
      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to create session' });
      }
    });

    // === Clear selected ===
    socket.on('clear-selected', async ({ betAmount, userId }) => {
      try {
        if (!userId || socket.userId !== userId) return socket.emit('error', { message: 'Unauthorized' });

        const sessions = await GameSession.find({ 
          betAmount, 
          userId, 
          status: { $in: ['active', 'ready'] } 
        });

        if (!sessions.length) return socket.emit('error', { message: 'No sessions found' });

        const user = await User.findById(userId);

        await GameSession.deleteMany({ betAmount, userId });
        stopGameCalling(betAmount); 
        activeGames.delete(betAmount);
        delete pendingWinners[betAmount];

        socket.emit('wallet-updated', user ? (user as any).wallet : 0);

        const updatedSessions = await GameSession.find({ status: { $in: ['active','ready'] } });
        io.emit('sessions-updated', await enrichWithUserPhones(updatedSessions));
      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to clear selected' });
      }
    });

    // === Refund Wallet ===
    socket.on('refund-wallet', async ({ betAmount, userId }) => {
      try {
        if (!userId || socket.userId !== userId) return socket.emit('error', { message: 'Unauthorized' });

        const sessions = await GameSession.find({ betAmount, userId, status: 'ready' });
        if (!sessions.length) return socket.emit('error', { message: 'No sessions found' });

        const totalRefund = betAmount * sessions.length;
        const user = await User.findById(userId);
        if (user) { (user as any).wallet += totalRefund; await user.save(); }

        await GameSession.deleteMany({ betAmount, userId });
        stopGameCalling(betAmount); 
        activeGames.delete(betAmount);
        delete pendingWinners[betAmount];

        socket.emit('wallet-updated', user ? (user as any).wallet : 0);

        const updatedSessions = await GameSession.find({ status: { $in: ['active','playing','ready'] } });
        io.emit('sessions-updated', await enrichWithUserPhones(updatedSessions));
      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to refund wallet' });
      }
    });

    // === Fund Wallet ===
    socket.on('fund-wallet', async ({ betAmount, userId }) => {
      try {
        if (!userId || socket.userId !== userId) return socket.emit('error', { message: 'Unauthorized' });

        const sessions = await GameSession.find({ betAmount, userId, status: 'active' });
        if (!sessions.length) return socket.emit('error', { message: 'No sessions found' });

        const totalAmount = betAmount * sessions.length;
        const user = await User.findById(userId);
        if (!user) return socket.emit('error', { message: 'User not found' });

        if ((user as any).wallet < totalAmount) return socket.emit('error', { message: 'Insufficient balance' });

        (user as any).wallet -= totalAmount;
        await user.save();

        socket.emit('wallet-updated', (user as any).wallet);
      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to fund wallet' });
      }
    });

    // === Delete session ===
    socket.on('delete-session', async ({ cardNumber, betAmount }) => {
      try {
        if (!socket.userId) return socket.emit('error', { message: 'Unauthorized' });

        const session = await GameSession.findOne({ cardNumber, betAmount, userId: socket.userId });
        if (!session) return socket.emit('error', { message: 'Session not found' });

        const user = await User.findById(socket.userId);
        await GameSession.findByIdAndDelete(session._id);

        const updated = await GameSession.find({ status: { $in: ['ready','active','playing'] } });
        socket.emit('wallet-updated', user ? (user as any).wallet : 0);
        io.emit('sessions-updated', await enrichWithUserPhones(updated));
      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to delete session' });
      }
    });

    // === Update session status ===
    socket.on('update-session-status', async ({ cardNumber, betAmount, status }) => {
      try {
        await GameSession.updateOne({ cardNumber, betAmount }, { status });
        const updated = await GameSession.find({ status: { $in: ['ready','active','playing'] } });
        io.emit('sessions-updated', await enrichWithUserPhones(updated));
      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to update session' });
      }
    });

    socket.on('update-session-status-by-bet', async ({ betAmount, status }) => {
      try {
        await GameSession.updateMany({ betAmount, status: 'ready' }, { status });
        const updated = await GameSession.find({ betAmount, status: { $in: ['active','ready','playing'] } });
        io.emit('sessions-updated', await enrichWithUserPhones(updated));
      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to update sessions by bet' });
      }
    });

    socket.on('update-session-status-by-user-bet', async ({ userId, betAmount, status }) => {
      try {
        await GameSession.updateMany({ userId, betAmount }, { status });
        const updated = await GameSession.find({ betAmount, status: { $in: ['ready','active','playing'] } });
        io.emit('sessions-updated', await enrichWithUserPhones(updated));
      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to update session by user+bet' });
      }
    });

    socket.on('update-ready-sessions-by-bet', async ({ betAmount, status }) => {
      try {
        await GameSession.updateMany({ betAmount, status: 'ready' }, { status });
        const updated = await GameSession.find({ status: { $in: ['active','playing'] } });
        io.emit('sessions-updated', await enrichWithUserPhones(updated));
      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to update ready sessions' });
      }
    });

    // === Game control ===
    socket.on('start-game', ({ betAmount }) => {
      try {
        startGameCalling(io, betAmount);
        const gameState = getGameState(betAmount);
        if (gameState) {
          socket.emit('game-state', {
            betAmount,
            calledNumbers: gameState.calledNumbers,
            currentNumber: gameState.calledNumbers.slice(-1)[0] || ""
          });
        }
      } catch (error: any) { socket.emit('error', { message: error.message }); }
    });

    socket.on('get-game-state', ({ betAmount }) => {
      try {
        const gameState = getGameState(betAmount);
        if (gameState) {
          socket.emit('game-state', {
            betAmount,
            calledNumbers: gameState.calledNumbers,
            currentNumber: gameState.calledNumbers.slice(-1)[0] || ""
          });
        }
      } catch (error: any) { socket.emit('error', { message: error.message }); }
    });

    socket.on('stop-game', ({ betAmount }) => {
      try {
        stopGameCalling(betAmount);
        activeGames.delete(betAmount);
        delete pendingWinners[betAmount];
        io.emit('game-stopped', { betAmount });
      } catch (error: any) { socket.emit('error', { message: error.message }); }
    });

    // === End game / winners ===
    socket.on('end-game', async ({ betAmount, winnerId, winnerCard, prizePool }) => {
      try {
        const gameState = activeGames.get(betAmount);
        if (!gameState || gameState.gameEnded) {
          return socket.emit('error', { message: 'Game already ended' });
        }

        // Mark game as ended to stop calling numbers
        gameState.gameEnded = true;
        
        if (!pendingWinners[betAmount]) pendingWinners[betAmount] = [];
        
        // Check if this winner already exists
        const existingWinner = pendingWinners[betAmount].find(
          w => w.userId === winnerId && w.card === winnerCard
        );
        
        if (!existingWinner) {
          pendingWinners[betAmount].push({ userId: winnerId, card: winnerCard });
          
          // Broadcast winner announcement to all clients
          io.emit('winner-announcement', {
            betAmount,
            winnerId,
            winnerCard,
            message: `Player ${winnerCard} claims BINGO!`
          });
        }

        // Start 3-second grace period on first winner
        if (pendingWinners[betAmount].length === 1) {
          setTimeout(async () => {
            try {
              const winners = pendingWinners[betAmount] || [];
              delete pendingWinners[betAmount];
              
              // Stop calling completely
              stopGameCalling(betAmount);
              
              if (!winners.length) return;
              
              const prizePerWinner = prizePool / winners.length;
              const winnerUpdates = [];

              for (const w of winners) {
                const user = await User.findById(w.userId);
                if (user) {
                  (user as any).wallet += prizePerWinner;
                  (user as any).dailyEarnings += prizePerWinner;
                  (user as any).weeklyEarnings += prizePerWinner;
                  (user as any).totalEarnings += prizePerWinner;
                  await user.save();
                  
                  winnerUpdates.push({
                    userId: w.userId,
                    card: w.card,
                    prize: prizePerWinner
                  });
                }
              }

              // Delete all sessions for this bet amount
              await GameSession.deleteMany({ betAmount });

              // Broadcast final game results to all clients
              io.emit('game-ended', {
                winners: winnerUpdates,
                prizePool,
                split: prizePerWinner,
                totalWinners: winners.length,
              });

              io.emit('sessions-updated', []);
            } catch (error: any) {
              socket.emit('error', { message: error.message || 'Failed to finalize game' });
            }
          }, 3000); // 3-second grace period
        }
      } catch (error: any) { 
        socket.emit('error', { message: error.message || 'Failed to end game' }); 
      }
    });

    socket.on('reset-game', async ({ betAmount }) => {
      try { 
        stopGameCalling(betAmount); 
        activeGames.delete(betAmount); 
        delete pendingWinners[betAmount];
        await GameSession.deleteMany({ betAmount }); 
      }
      catch (error: any) { socket.emit('error', { message: error.message }); }
    });

    socket.on('test-game', async ({ betAmount }) => {
      try { 
        stopGameCalling(betAmount); 
        activeGames.delete(betAmount); 
        delete pendingWinners[betAmount];
        await GameSession.deleteMany({ betAmount }); 
      }
      catch (error: any) { socket.emit('error', { message: error.message }); }
    });

    socket.on('disconnect', (reason) => console.log('Client disconnected:', socket.id, 'Reason:', reason));
    socket.on('error', (error) => console.error('Socket error:', error));
  });

  console.log('Socket.io server setup complete');
}