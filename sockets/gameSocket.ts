// =============================
// File: src/socket/setupSocket.ts (FULLY CORRECTED)
// =============================
import { Server, Socket } from 'socket.io';
import mongoose from 'mongoose';
import User from '../models/User';
import GameHistory from '../models/GameHistory';
import GameSession, { IGameSession } from '../models/GameSession';

interface AuthenticatedSocket extends Socket { userId?: string; }

// ---- Bingo calling logic ----
interface GameState {
  betAmount: number;
  calledNumbers: string[];
  remainingNumbers: string[];
  isCalling: boolean;
  callingInterval?: NodeJS.Timeout;
  isGameEnded: boolean;
  pendingWinners: Array<{userId: string; card: number}>;
  gracePeriodTimer?: NodeJS.Timeout;
  numberOfPlayers: number;
  prizePool: number;
  totalBets: number;
  callCount: number;
  startTime: number;
}

const activeGames = new Map<number, GameState>();

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

async function startGameCalling(io: Server, betAmount: number) {
  // Clear any existing interval for this bet amount
  if (activeGames.has(betAmount)) {
    const existingGame = activeGames.get(betAmount)!;
    if (existingGame.callingInterval) {
      clearInterval(existingGame.callingInterval);
    }
    if (existingGame.gracePeriodTimer) {
      clearTimeout(existingGame.gracePeriodTimer);
    }
  }
  
  // GET ACTUAL NUMBER OF PLAYERS AND CALCULATE PRIZE POOL
  const activeSessions = await GameSession.find({ 
    betAmount, 
    status: { $in: ['active', 'playing', 'ready'] } 
  });
  
  const numberOfPlayers = activeSessions.length;
  const totalBets = numberOfPlayers * betAmount;
  const prizePool = totalBets * 0.8; // 80% of total bets

  const all = generateAllBingoNumbers();
  const shuffled = shuffleNumbers(all);
  
  const gameState: GameState = { 
    betAmount, 
    calledNumbers: [], 
    remainingNumbers: shuffled, 
    isCalling: true,
    isGameEnded: false,
    pendingWinners: [],
    numberOfPlayers: numberOfPlayers,
    prizePool: prizePool,
    totalBets: totalBets,
    callCount: 0,
    startTime: Date.now()
  };
  
  activeGames.set(betAmount, gameState);
  
  console.log(`🎮 Game started for betAmount: ${betAmount}, Players: ${numberOfPlayers}, Prize Pool: ${prizePool}`);

  // PRECISE TIMING FUNCTION - NO DRIFT
  const callNextNumber = () => {
    const game = activeGames.get(betAmount);
    if (!game || game.remainingNumbers.length === 0 || game.isGameEnded) {
      stopGameCalling(betAmount);
      return;
    }
    
    const nextNumber = game.remainingNumbers[0];
    game.calledNumbers.push(nextNumber);
    game.remainingNumbers = game.remainingNumbers.slice(1);
    
    io.emit('number-called', { 
      betAmount, 
      number: nextNumber, 
      calledNumbers: game.calledNumbers 
    });
    
    console.log(`🔢 Number called: ${nextNumber} for betAmount: ${betAmount}`);
    
    if (game.remainingNumbers.length === 0) {
      stopGameCalling(betAmount);
    }
    
    game.callCount++;
  };

  // FIRST CALL IMMEDIATELY
  callNextNumber();
  
  // SUBSEQUENT CALLS WITH PRECISE TIMING
  gameState.callingInterval = setInterval(() => {
    const game = activeGames.get(betAmount);
    if (!game || game.isGameEnded) return;
    
    // Calculate precise timing to prevent drift
    const expectedTime = game.startTime + (game.callCount * 4000);
    const delay = Math.max(0, expectedTime - Date.now());
    
    if (delay > 100) { // If significant delay needed
      setTimeout(callNextNumber, delay);
    } else {
      callNextNumber();
    }
  }, 4000);
}

function stopGameCalling(betAmount: number) {
  const g = activeGames.get(betAmount);
  if (g) {
    if (g.callingInterval) {
      clearInterval(g.callingInterval);
      g.callingInterval = undefined;
    }
    g.isCalling = false;
    g.isGameEnded = true;
    console.log(`⏹️ Game stopped for betAmount: ${betAmount}`);
  }
}

function getGameState(betAmount: number) { 
  return activeGames.get(betAmount); 
}

async function handleWinnerSubmission(io: Server, betAmount: number, winnerId: string, winnerCard: number) {
  const gameState = activeGames.get(betAmount);
  if (!gameState) {
    console.log(`❌ No active game found for betAmount: ${betAmount}`);
    return;
  }

  // Check if this winner was already submitted
  const isDuplicate = gameState.pendingWinners.some(w => 
    w.userId === winnerId && w.card === winnerCard
  );
  
  if (isDuplicate) {
    console.log(`🚫 Duplicate winner submission rejected: ${winnerId}, card ${winnerCard}`);
    return;
  }

  // Stop calling numbers immediately when first winner is found
  if (!gameState.isGameEnded) {
    console.log(`🎉 First winner found! Stopping game for betAmount: ${betAmount}`);
    stopGameCalling(betAmount);
    
    // Broadcast that game has stopped and first winner found
    io.emit('game-stopped', { 
      betAmount, 
      firstWinner: { userId: winnerId, card: winnerCard },
      message: `Player ${winnerCard} wins! 4-second grace period started.`
    });

    console.log(`⏰ Starting 4-second grace period for betAmount: ${betAmount}`);
    
    // Start grace period timer
    gameState.gracePeriodTimer = setTimeout(async () => {
      console.log(`⏰ Grace period ended for betAmount: ${betAmount}`);
      await finalizeGame(io, betAmount);
    }, 4000);
  }

  // Add winner to pending list
  gameState.pendingWinners.push({ userId: winnerId, card: winnerCard });
  console.log(`✅ Winner added: ${winnerId}, card ${winnerCard}. Total winners: ${gameState.pendingWinners.length}`);

  // Broadcast individual winner for toast notification
  io.emit('winner-announced', {
    betAmount,
    winnerId,
    winnerCard,
    totalWinnersSoFar: gameState.pendingWinners.length,
    message: `Player ${winnerCard} wins!`
  });

  console.log(`📢 Announced winner: Player ${winnerCard} for betAmount: ${betAmount}`);
}

async function finalizeGame(io: Server, betAmount: number) {
  const gameState = activeGames.get(betAmount);
  if (!gameState) {
    console.log(`❌ Cannot finalize game - no state found for betAmount: ${betAmount}`);
    return;
  }

  const winners = gameState.pendingWinners;
  console.log(`🎯 Finalizing game for betAmount: ${betAmount} with ${winners.length} winners`);
  
  try {
    const prizePool = gameState.prizePool;
    const totalBets = gameState.totalBets;
    const numberOfPlayers = gameState.numberOfPlayers;

    // Delete all sessions for this bet amount
    await GameSession.deleteMany({ betAmount });
    console.log(`🗑️ Deleted sessions for betAmount: ${betAmount}`);

    let prizePerWinner = 0;
    if (winners.length > 0) {
      prizePerWinner = prizePool / winners.length;

      console.log(`💰 Distributing prize pool: ${prizePool} among ${winners.length} winners`);
      console.log(`🎁 Each winner gets: ${prizePerWinner}`);

      // Update winners' wallets and create game history
      for (const winner of winners) {
        const user = await User.findById(winner.userId);
        if (user) {
          const originalWallet = (user as any).wallet;
          (user as any).wallet += prizePerWinner;
          (user as any).dailyEarnings += prizePerWinner;
          (user as any).weeklyEarnings += prizePerWinner;
          (user as any).totalEarnings += prizePerWinner;
          await user.save();
          console.log(`💳 Updated wallet for user: ${winner.userId}, Added: ${prizePerWinner}`);
        }

        // Create game history record
        await GameHistory.create({
          winnerId: winner.userId,
          winnerCard: winner.card,
          prizePool: prizePerWinner,
          numberOfPlayers: numberOfPlayers,
          betAmount: betAmount,
          createdAt: new Date()
        });
      }

      console.log(`📢 Broadcasting final results to all clients: ${winners.length} winners`);
      
      // Broadcast final game results to ALL clients
      io.emit('game-ended', {
        winners: winners,
        prizePool: prizePool,
        split: prizePerWinner,
        totalWinners: winners.length,
        betAmount: betAmount
      });
    } else {
      console.log('😞 No winners found for this game');
      io.emit('game-ended', {
        winners: [],
        prizePool: 0,
        split: 0,
        totalWinners: 0,
        betAmount: betAmount
      });
    }

    // Clear the game state
    activeGames.delete(betAmount);
    console.log(`🧹 Game state cleared for betAmount: ${betAmount}`);

    // Emit empty sessions list
    io.emit('sessions-updated', []);

  } catch (error) {
    console.error('❌ Error finalizing game:', error);
    io.emit('error', { message: 'Failed to finalize game' });
  }
}

// Helper: attach user phones
async function enrichWithUserPhones(sessions: IGameSession[]) {
  try {
    const uniqueUserIds = Array.from(new Set(sessions.map(s => String(s.userId))));
    
    if (uniqueUserIds.length === 0) return sessions.map(s => ({
      ...s.toObject(),
      userId: { _id: s.userId, phone: null }
    }));
    
    const users = await User.find({ _id: { $in: uniqueUserIds } }).select('phone');
    const phoneMap = new Map<string, string>();
    users.forEach(u => { 
      phoneMap.set(String(u._id), (u as any).phone); 
    });
    
    return sessions.map(s => ({
      ...s.toObject(),
      userId: { _id: s.userId, phone: phoneMap.get(String(s.userId)) || null }
    }));
  } catch (error) {
    console.error('Error enriching with user phones:', error);
    return sessions.map(s => ({
      ...s.toObject(),
      userId: { _id: s.userId, phone: null }
    }));
  }
}

export function setupSocket(io: Server) {
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = (socket.handshake as any).auth?.token || (socket.handshake.query as any).token;
      if (!token) return next(new Error('Authentication error'));
      socket.userId = socket.handshake.query.userId as string;
      next();
    } catch (error) { 
      console.error('Authentication error:', error);
      next(new Error('Authentication error')); 
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log('🔌 Client connected:', socket.id, 'User:', socket.userId);

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
        
        if (userId !== socket.userId) {
          return socket.emit('error', { message: 'Unauthorized' });
        }

        const existing = await GameSession.findOne({
          cardNumber, betAmount, status: { $in: ['ready','active','playing'] }
        });
        
        if (existing) {
          return socket.emit('error', { message: 'Card already taken' });
        }

        const created = await GameSession.create({
          userId: new mongoose.Types.ObjectId(userId),
          cardNumber, 
          betAmount, 
          status: 'active', 
          createdAt
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

    // === Game control ===
    socket.on('start-game', async ({ betAmount }) => {
      try {
        console.log(`🎮 Request to start game for betAmount: ${betAmount}`);
        
        const gameState = activeGames.get(betAmount);
        if (!gameState || !gameState.isGameEnded) {
          await startGameCalling(io, betAmount);
        }
        
        const currentGameState = getGameState(betAmount);
        if (currentGameState) {
          socket.emit('game-state', {
            betAmount,
            calledNumbers: currentGameState.calledNumbers,
            currentNumber: currentGameState.calledNumbers.slice(-1)[0] || ""
          });
        }
      } catch (error: any) { 
        socket.emit('error', { message: error.message }); 
      }
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
      } catch (error: any) { 
        socket.emit('error', { message: error.message }); 
      }
    });

    socket.on('stop-game', ({ betAmount }) => {
      try {
        stopGameCalling(betAmount);
        activeGames.delete(betAmount);
        io.emit('game-stopped', { betAmount });
      } catch (error: any) { 
        socket.emit('error', { message: error.message }); 
      }
    });

    // === End game / winners ===
    socket.on('end-game', async ({ betAmount, winnerId, winnerCard, prizePool }) => {
      try {
        console.log(`🎯 Winner submission received: ${winnerId}, card ${winnerCard}, betAmount: ${betAmount}`);
        
        const gameState = activeGames.get(betAmount);
        if (!gameState) {
          return socket.emit('error', { message: 'No active game found' });
        }

        if (gameState.isGameEnded) {
          return socket.emit('error', { message: 'Game has already ended' });
        }

        // Handle the winner submission
        await handleWinnerSubmission(io, betAmount, winnerId, winnerCard);
        
      } catch (error: any) { 
        socket.emit('error', { message: error.message || 'Failed to process win' }); 
      }
    });

    socket.on('disconnect', (reason) => {
      console.log('🔌 Client disconnected:', socket.id, 'Reason:', reason);
    });
    
    socket.on('error', (error) => {
      console.error('❌ Socket error:', error);
    });
  });

  console.log('✅ Socket.io server setup complete');
}