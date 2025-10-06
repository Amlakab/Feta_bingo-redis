// =============================
// File: src/socket/setupSocket.ts (FIXED DATA CONSISTENCY)
// =============================
import { Server, Socket } from 'socket.io';
import mongoose from 'mongoose';
import User from '../models/User';
import GameHistory from '../models/GameHistory';
import GameSession, { IGameSession } from '../models/GameSession';
import Games from '../models/Games';

interface AuthenticatedSocket extends Socket { userId?: string; }

// ---- Bingo Game State ----
interface GameState {
  betAmount: number;
  calledNumbers: string[];
  remainingNumbers: string[];
  isCalling: boolean;
  callingInterval?: NodeJS.Timeout;
  isGameEnded: boolean;
  pendingWinners: Array<{userId: string; card: number}>;
  gracePeriodTimer?: NodeJS.Timeout;
  gracePeriodActive: boolean;
}

// ---- Server-side Timing Control ----
interface BetTimerState {
  status: 'ready' | 'active' | 'in-progress';
  timer: number;
  playerCount: number;
  prizePool: number;
  createdAt: Date | null;
}

const activeGames = new Map<number, GameState>();
const betTimers = new Map<number, BetTimerState>();
let globalTimerInterval: NodeJS.Timeout | null = null;

// Initialize and start the global timer
function startGlobalTimer(io: Server) {
  if (globalTimerInterval) {
    clearInterval(globalTimerInterval);
    globalTimerInterval = null;
  }

  globalTimerInterval = setInterval(async () => {
    let hasChanges = false;
    
    for (const [betAmount, currentState] of betTimers.entries()) {
      const newState = { ...currentState };
      let stateChanged = false;

      // ALWAYS update player count and prize pool regardless of status
      await updateBetTimerStats(betAmount);
      
      // Check if there are playing sessions for this bet amount (this determines in-progress status)
      const playingSessions = await GameSession.find({ 
        betAmount, 
        status: 'playing' 
      });
      const hasPlayingGame = playingSessions.length > 0;

      if (hasPlayingGame) {
        // Game is in progress - set status to in-progress
        if (newState.status !== 'in-progress') {
          newState.status = 'in-progress';
          newState.timer = 0;
          stateChanged = true;
          console.log(`Timer ${betAmount}: → IN-PROGRESS (game playing)`);
        }
      } else if (newState.status === 'ready') {
        // Ready phase countdown
        if (newState.timer > 0) {
          newState.timer -= 1;
          stateChanged = true;
        }
        
        if (newState.timer <= 0) {
          newState.status = 'active';
          newState.timer = 45;
          newState.createdAt = new Date();
          stateChanged = true;
          console.log(`Timer ${betAmount}: READY → ACTIVE (45s)`);
        }
      } else if (newState.status === 'active') {
        // Active phase countdown
        if (newState.timer > 0) {
          newState.timer -= 1;
          stateChanged = true;
        }
        
        if (newState.timer <= 0) {
          // Check if we have active sessions to potentially start a game
          const activeSessions = await GameSession.find({ 
            betAmount, 
            status: { $in: ['active', 'ready'] } 
          });
          
          if (activeSessions.length > 0) {

          //   const deleteResult = await GameSession.deleteMany({
          //   betAmount,
          //   status: 'active'
          // });
            // Players are present but game hasn't started yet - restart active phase
            newState.timer = 45;
            newState.createdAt = new Date();
            console.log(`Timer ${betAmount}: ACTIVE → ACTIVE (restart 45s - players waiting)`);
          } else {
            // No players - go back to ready
            newState.status = 'ready';
            newState.timer = 5;
            newState.createdAt = null;
            console.log(`Timer ${betAmount}: ACTIVE → READY (no players)`);
          }
          stateChanged = true;
        }
      } else if (newState.status === 'in-progress' && !hasPlayingGame) {
        // Game ended - reset to ready
        newState.status = 'ready';
        newState.timer = 5;
        newState.createdAt = null;
        stateChanged = true;
        console.log(`Timer ${betAmount}: IN-PROGRESS → READY (game ended)`);
      }

      if (stateChanged) {
        betTimers.set(betAmount, newState);
        hasChanges = true;
      }
    }

    if (hasChanges) {
      broadcastTimerStates(io);
    }
  }, 1000);

  console.log('Global timer started successfully');
}

// CORRECTED: Enhanced function with immediate broadcast capability
async function updateBetTimerStats(betAmount: number, io?: Server) {
  try {
    // ALWAYS count from database - never use cached values
    const allSessions = await GameSession.find({ 
      betAmount, 
      status: { $in: ['active', 'ready', 'playing'] } 
    });
    
    const playerCount = allSessions.length;
    const prizePool = playerCount * betAmount * 0.8;
    
    // ALWAYS update the timer state with fresh data
    if (!betTimers.has(betAmount)) {
      betTimers.set(betAmount, {
        status: 'ready',
        timer: 5,
        playerCount: 0,
        prizePool: 0,
        createdAt: null
      });
    }
    
    const timerState = betTimers.get(betAmount)!;
    
    // Check if values actually changed to avoid unnecessary broadcasts
    const valuesChanged = 
      timerState.playerCount !== playerCount || 
      timerState.prizePool !== prizePool;
    
    timerState.playerCount = playerCount;
    timerState.prizePool = prizePool;
    
    console.log(`✅ Updated stats for ${betAmount}: ${playerCount} players, prize: ${prizePool}`);
    
    // Broadcast changes immediately if values changed and IO instance provided
    if (valuesChanged && io) {
      console.log(`📢 Broadcasting immediate update for ${betAmount}`);
      broadcastTimerStates(io);
    }
    
    return valuesChanged;
    
  } catch (error) {
    console.error('❌ Error updating bet timer stats:', error);
    return false;
  }
}

// NEW: Centralized function for session cleanup with guaranteed stats update
async function cleanupSessionsAndUpdateStats(io: Server, betAmount: number, filter: any = {}) {
  try {
    // Delete sessions based on filter
    const deleteResult = await GameSession.deleteMany(filter);
    console.log(`🧹 Cleaned up sessions for ${betAmount}:`, deleteResult.deletedCount, 'sessions removed');
    
    // FORCE stats update and broadcast
    await updateBetTimerStats(betAmount, io);
    
    return deleteResult.deletedCount;
  } catch (error) {
    console.error('Error in cleanupSessionsAndUpdateStats:', error);
    return 0;
  }
}

// Initialize timers for all bet amounts
async function initializeBetTimers(io: Server) {
  try {
    // Read available bet amounts from database
    const games = await Games.find().select('betAmount');
    const betAmounts = games.map(game => game.betAmount);
    
    // Clear any existing timers
    betTimers.clear();
    
    // Initialize timer for each unique bet amount
    betAmounts.forEach((betAmount: number) => {
      betTimers.set(betAmount, {
        status: 'ready',
        timer: 5,
        playerCount: 0,
        prizePool: 0,
        createdAt: null
      });
      console.log(`Initialized timer for bet amount: ${betAmount}`);
    });
    
    console.log(`Initialized timers for ${betAmounts.length} bet amounts:`, betAmounts);
    
    startGlobalTimer(io);
    broadcastTimerStates(io);
  } catch (error) {
    console.error('Error initializing bet timers:', error);
  }
}

// Broadcast timer states to all clients
function broadcastTimerStates(io: Server) {
  const timerStates: {[key: number]: BetTimerState} = {};
  
  betTimers.forEach((state, betAmount) => {
    timerStates[betAmount] = {
      status: state.status,
      timer: state.timer,
      playerCount: state.playerCount,
      prizePool: state.prizePool,
      createdAt: state.createdAt
    };
  });
  
  console.log('Broadcasting timer states:', timerStates);
  io.emit('timer-states-update', timerStates);
}

// Set bet timer to in-progress when game starts
function setBetTimerInProgress(betAmount: number) {
  const timerState = betTimers.get(betAmount);
  if (timerState) {
    timerState.status = 'in-progress';
    timerState.timer = 0;
    console.log(`Timer ${betAmount} set to IN-PROGRESS (game started)`);
  }
}

// Reset bet timer when game ends
function resetBetTimer(betAmount: number) {
  const timerState = betTimers.get(betAmount);
  if (timerState) {
    timerState.status = 'ready';
    timerState.timer = 5;
    timerState.createdAt = null;
    console.log(`Timer ${betAmount} reset to READY (game ended)`);
  }
}

// Add timer for new bet amount dynamically
function ensureBetTimerExists(betAmount: number) {
  if (!betTimers.has(betAmount)) {
    betTimers.set(betAmount, {
      status: 'ready',
      timer: 5,
      playerCount: 0,
      prizePool: 0,
      createdAt: null
    });
    console.log(`Created new timer for bet amount: ${betAmount}`);
  }
}

// Your existing bingo game functions remain the same
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
  // Set timer to in-progress when game starts
  setBetTimerInProgress(betAmount);
  broadcastTimerStates(io);
  
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
  
  const all = generateAllBingoNumbers();
  const shuffled = shuffleNumbers(all);
  const gameState: GameState = { 
    betAmount, 
    calledNumbers: [], 
    remainingNumbers: shuffled, 
    isCalling: true,
    isGameEnded: false,
    pendingWinners: [],
    gracePeriodActive: false
  };
  
  activeGames.set(betAmount, gameState);

  gameState.callingInterval = setInterval(async () => {
    const game = activeGames.get(betAmount);
    if (!game || game.remainingNumbers.length === 0 || game.isGameEnded) {
      stopGameCalling(betAmount);
      
      if (game && game.remainingNumbers.length === 0 && game.pendingWinners.length === 0) {
        console.log(`All 75 numbers called with no winner for betAmount: ${betAmount}. Cleaning up sessions.`);
        await handleNoWinnerGame(io, betAmount);
      }
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
    
    if (game.remainingNumbers.length === 0) {
      stopGameCalling(betAmount);
      
      if (game.pendingWinners.length === 0) {
        console.log(`All 75 numbers called with no winner for betAmount: ${betAmount}. Cleaning up sessions.`);
        await handleNoWinnerGame(io, betAmount);
      }
    }
  }, 5000);
}

async function handleNoWinnerGame(io: Server, betAmount: number) {
  const gameState = activeGames.get(betAmount);
  if (!gameState) return;

  endGameCompletely(io, betAmount);
  
  try {
    // Use centralized cleanup function instead of direct deletion
    await cleanupSessionsAndUpdateStats(io, betAmount, { betAmount });
    console.log(`Deleted all sessions for betAmount: ${betAmount} (no winner)`);
    
    io.emit('game-ended', {
      winners: [],
      prizePool: 0,
      split: 0,
      totalWinners: 0,
      betAmount: betAmount,
      message: 'Game ended - all numbers called with no winner'
    });
    
    io.emit('sessions-updated', []);
    activeGames.delete(betAmount);
    console.log(`Game state cleared for betAmount: ${betAmount} (no winner)`);
    
  } catch (error) {
    console.error('Error handling no-winner game:', error);
    io.emit('error', { message: 'Failed to clean up no-winner game' });
  }
}

function stopGameCalling(betAmount: number) {
  const g = activeGames.get(betAmount);
  if (g) {
    if (g.callingInterval) {
      clearInterval(g.callingInterval);
      g.callingInterval = undefined;
    }
    g.isCalling = false;
  }
}

function endGameCompletely(io: Server, betAmount: number) {
  const g = activeGames.get(betAmount);
  if (g) {
    g.isGameEnded = true;
    g.gracePeriodActive = false;
    if (g.gracePeriodTimer) {
      clearTimeout(g.gracePeriodTimer);
      g.gracePeriodTimer = undefined;
    }
    
    resetBetTimer(betAmount);
    // Update stats after game ends
    updateBetTimerStats(betAmount, io); // Added io parameter
  }
}

function getGameState(betAmount: number) { 
  return activeGames.get(betAmount); 
}

async function handleWinnerSubmission(io: Server, betAmount: number, winnerId: string, winnerCard: number, prizePool: number) {
  const gameState = activeGames.get(betAmount);
  if (!gameState) {
    console.log(`No active game found for betAmount: ${betAmount}`);
    return;
  }

  const isDuplicate = gameState.pendingWinners.some(w => 
    w.userId === winnerId && w.card === winnerCard
  );
  
  if (isDuplicate) {
    console.log(`Duplicate winner submission rejected: ${winnerId}, card ${winnerCard}`);
    return;
  }

  if (gameState.isCalling) {
    console.log(`First winner found! Stopping number calling for betAmount: ${betAmount}`);
    stopGameCalling(betAmount);
    
    gameState.gracePeriodActive = true;
    
    io.emit('game-stopped', { 
      betAmount, 
      firstWinner: { userId: winnerId, card: winnerCard },
      message: `Player ${winnerCard} wins! 4-second grace period started.`,
      allWinners: gameState.pendingWinners
    });

    if (!gameState.gracePeriodTimer) {
      console.log(`Starting 4-second grace period timer for betAmount: ${betAmount}`);
      gameState.gracePeriodTimer = setTimeout(async () => {
        console.log(`Grace period ended for betAmount: ${betAmount}, finalizing game...`);
        await finalizeGame(io, betAmount, prizePool);
      }, 4000);
    }
  }

  gameState.pendingWinners.push({ userId: winnerId, card: winnerCard });
  console.log(`Winner added: ${winnerId}, card ${winnerCard}. Total winners: ${gameState.pendingWinners.length}`);

  io.emit('winner-announced', {
    betAmount,
    winnerId,
    winnerCard,
    totalWinnersSoFar: gameState.pendingWinners.length,
    message: `Player ${winnerCard} wins! (${gameState.pendingWinners.length} winners so far)`
  });
}

async function finalizeGame(io: Server, betAmount: number, prizePool: number) {
  const gameState = activeGames.get(betAmount);
  if (!gameState) {
    console.log(`Cannot finalize game - no state found for betAmount: ${betAmount}`);
    return;
  }

  endGameCompletely(io, betAmount);
  
  const winners = gameState.pendingWinners;
  console.log(`Finalizing game for betAmount: ${betAmount} with ${winners.length} winners`);
  
  try {
    const sessions = await GameSession.find({ betAmount });
    const numberOfPlayers = sessions.length;

    // Use centralized cleanup function instead of direct deletion
    await cleanupSessionsAndUpdateStats(io, betAmount, { betAmount });
    console.log(`Deleted sessions for betAmount: ${betAmount}`);

    let prizePerWinner = 0;
    if (winners.length > 0) {
      prizePerWinner = prizePool / winners.length;

      for (const winner of winners) {
        const user = await User.findById(winner.userId);
        if (user) {
          (user as any).wallet += prizePerWinner;
          (user as any).dailyEarnings += prizePerWinner;
          (user as any).weeklyEarnings += prizePerWinner;
          (user as any).totalEarnings += prizePerWinner;
          await user.save();
          console.log(`Updated wallet for user: ${winner.userId}, added ${prizePerWinner}`);
        }

        await GameHistory.create({
          winnerId: winner.userId,
          winnerCard: winner.card,
          prizePool: prizePerWinner,
          numberOfPlayers: numberOfPlayers,
          betAmount: betAmount,
          createdAt: new Date()
        });
      }

      console.log(`Broadcasting final results to all clients: ${winners.length} winners`);
      
      io.emit('game-ended', {
        winners: winners,
        prizePool: prizePool,
        split: prizePerWinner,
        totalWinners: winners.length,
        betAmount: betAmount
      });
    } else {
      console.log('No winners found for this game');
      io.emit('game-ended', {
        winners: [],
        prizePool: 0,
        split: 0,
        totalWinners: 0,
        betAmount: betAmount
      });
    }

    activeGames.delete(betAmount);
    console.log(`Game state cleared for betAmount: ${betAmount}`);

    io.emit('sessions-updated', []);

  } catch (error) {
    console.error('Error finalizing game:', error);
    io.emit('error', { message: 'Failed to finalize game' });
  }
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
  // Initialize bet timers
  initializeBetTimers(io);
  
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

    // Send current timer states immediately to newly connected client
    const initialTimerStates: {[key: number]: BetTimerState} = {};
    betTimers.forEach((state, betAmount) => {
      initialTimerStates[betAmount] = { ...state };
    });
    socket.emit('timer-states-update', initialTimerStates);

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
        
        // Update player counts for timers
        for (const session of sessions) {
          await updateBetTimerStats(session.betAmount);
        }
        
        // Broadcast updated timer states
        broadcastTimerStates(io);
        
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

        // Ensure timer exists for this bet amount
        ensureBetTimerExists(betAmount);

        const created = await GameSession.create({
          userId: new mongoose.Types.ObjectId(userId),
          cardNumber, 
          betAmount, 
          status: 'active', 
          createdAt: new Date().toISOString()
        });

        // ✅ FIXED: Use enhanced update function with broadcast
        await updateBetTimerStats(betAmount, io);

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

      // ONLY delete sessions for this specific user AND bet amount
      const deleteResult = await GameSession.deleteMany({
        betAmount: betAmount, // Critical: scope to current bet amount
        userId: userId,
        status: { $in: ['active', 'ready'] }
      });

      console.log(`Cleared ${deleteResult.deletedCount} sessions for user ${userId}, bet ${betAmount}`);

      // Update user wallet
      const user = await User.findById(userId);
      if (user) {
        // Optional: Refund based on cleared sessions
        const refundAmount = betAmount * deleteResult.deletedCount;
        (user as any).wallet += refundAmount;
        await user.save();
      }

      // Get updated sessions FOR THIS BET AMOUNT ONLY
      const updatedSessions = await GameSession.find({ 
        betAmount: betAmount, // Only sessions for this bet amount
        status: { $in: ['active','ready','playing'] } 
      });
      
      const enrichedSessions = await enrichWithUserPhones(updatedSessions);
      
      // Update timer stats for THIS BET AMOUNT
      await updateBetTimerStats(betAmount, io);
      
      // Emit wallet update to user
      socket.emit('wallet-updated', user ? (user as any).wallet : 0);
      
      // Broadcast session updates for THIS BET AMOUNT
      io.emit('sessions-updated', enrichedSessions);
      
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

        // ✅ FIXED: Use centralized cleanup function
        await cleanupSessionsAndUpdateStats(io, betAmount, { betAmount, userId });
        
        // Only affect game if it's active
        const gameState = activeGames.get(betAmount);
        if (gameState && !gameState.isGameEnded) {
          stopGameCalling(betAmount);
          endGameCompletely(io, betAmount);
        }

        socket.emit('wallet-updated', user ? (user as any).wallet : 0);

        const updatedSessions = await GameSession.find({ status: { $in: ['active','playing','ready'] } });
        io.emit('sessions-updated', await enrichWithUserPhones(updatedSessions));
        
      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to refund wallet' });
      }
    });

    // === Delete session ===
    socket.on('delete-session', async ({ cardNumber, betAmount }) => {
      try {
        if (!socket.userId) return socket.emit('error', { message: 'Unauthorized' });

        const session = await GameSession.findOne({ cardNumber, betAmount, userId: socket.userId });
        if (!session) return socket.emit('error', { message: 'Session not found' });

        const user = await User.findById(socket.userId);
        
        // ✅ FIXED: Use centralized cleanup function
        await cleanupSessionsAndUpdateStats(io, betAmount, { 
          cardNumber, betAmount, userId: socket.userId 
        });

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
        
        // ✅ FIXED: Use enhanced update function with broadcast
        await updateBetTimerStats(betAmount, io);
        
        const updated = await GameSession.find({ status: { $in: ['ready','active','playing'] } });
        io.emit('sessions-updated', await enrichWithUserPhones(updated));
        
      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to update session' });
      }
    });

    socket.on('update-session-status-by-bet', async ({ betAmount, status }) => {
      try {
        // 1. Perform the update only on documents with status 'ready'
        const updateResult = await GameSession.updateMany(
          { betAmount, status: 'ready' },
          { $set: { status: status } }
        );

        // 2. Delete sessions with status 'active' and same betAmount
        const deleteResult = await GameSession.deleteMany({
          betAmount,
          status: 'active'
        });

        // ✅ FIXED: Use enhanced update function with broadcast
        await updateBetTimerStats(betAmount, io);

        // 3. Find only the documents that were just updated (now have the new status)
        const updatedSessions = await GameSession.find({
          betAmount,
          status: status
        });

        // 4. Emit the list of updated sessions
        io.emit('sessions-updated', await enrichWithUserPhones(updatedSessions));

      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to update sessions by bet' });
      }
    });

    socket.on('update-session-status-by-user-bet', async ({ userId, betAmount, status }) => {
      try {
        await GameSession.updateMany({ userId, betAmount }, { status });
        
        // ✅ FIXED: Use enhanced update function with broadcast
        await updateBetTimerStats(betAmount, io);
        
        const updated = await GameSession.find({ betAmount, status: { $in: ['ready','active','playing'] } });
        io.emit('sessions-updated', await enrichWithUserPhones(updated));
        
      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to update session by user+bet' });
      }
    });

    socket.on('update-ready-sessions-by-bet', async ({ betAmount, status }) => {
      try {
        await GameSession.updateMany({ betAmount, status: 'ready' }, { status });
        
        // ✅ FIXED: Use enhanced update function with broadcast
        await updateBetTimerStats(betAmount, io);
        
        const updated = await GameSession.find({ status: { $in: ['active','playing'] } });
        io.emit('sessions-updated', await enrichWithUserPhones(updated));
        
      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to update ready sessions' });
      }
    });

    // === Game control ===
    socket.on('start-game', ({ betAmount }) => {
      try {
        const gameState = activeGames.get(betAmount);
        if (!gameState || gameState.isGameEnded) {
          startGameCalling(io, betAmount);
        }
        const currentGameState = getGameState(betAmount);
        if (currentGameState) {
          socket.emit('game-state', {
            betAmount,
            calledNumbers: currentGameState.calledNumbers,
            currentNumber: currentGameState.calledNumbers.slice(-1)[0] || ""
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
        endGameCompletely(io, betAmount);
        io.emit('game-stopped', { betAmount });
      } catch (error: any) { socket.emit('error', { message: error.message }); }
    });

    // === End game / winners ===
    socket.on('end-game', async ({ betAmount, winnerId, winnerCard, prizePool }) => {
      try {
        console.log(`Winner submission received: ${winnerId}, card ${winnerCard}, betAmount: ${betAmount}`);
        
        const gameState = activeGames.get(betAmount);
        if (!gameState) {
          console.log(`No active game for betAmount: ${betAmount}`);
          return socket.emit('error', { message: 'No active game found' });
        }

        if (gameState.isGameEnded) {
          console.log(`Game already fully ended for betAmount: ${betAmount}`);
          return socket.emit('error', { message: 'Game has already ended' });
        }

        await handleWinnerSubmission(io, betAmount, winnerId, winnerCard, prizePool);
        
      } catch (error: any) { 
        console.error('Error in end-game:', error);
        socket.emit('error', { message: error.message || 'Failed to process win' }); 
      }
    });

    // === Get timer states ===
    socket.on('get-timer-states', () => {
      try {
        const timerStates: {[key: number]: BetTimerState} = {};
        betTimers.forEach((state, betAmount) => {
          timerStates[betAmount] = { ...state };
        });
        socket.emit('timer-states-update', timerStates);
      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to get timer states' });
      }
    });

    // Remove get-remaining-time endpoint since we're handling timing completely on server
    socket.on('get-remaining-time', async ({ betAmount }) => {
      try {
        // Find the earliest active session for this bet amount
        const earliestSession = await GameSession.findOne({
          betAmount,
          status: { $in: ['active', 'ready'] }
        }).sort({ createdAt: 1 });

        if (!earliestSession) {
          // No active sessions, return initial time (45 seconds)
          socket.emit('remaining-time', { betAmount, remainingTime: 45 });
          return;
        }

        // Calculate remaining time based on the earliest session
        const sessionStartTime = new Date(earliestSession.createdAt).getTime();
        const currentTime = new Date().getTime();
        const elapsedSeconds = Math.floor((currentTime - sessionStartTime) / 1000);
        const remainingTime = Math.max(0, 45 - elapsedSeconds);

        socket.emit('remaining-time', { betAmount, remainingTime });
      } catch (error: any) {
        console.error('Error calculating remaining time:', error);
        socket.emit('error', { message: 'Failed to calculate remaining time' });
      }
    });

    // Add this inside your io.on('connection') handler in setupSocket.ts
      socket.on('get-server-time', (callback) => {
        try {
          const serverTime = Date.now();
          const response = {
            serverTime: serverTime,
            serverTimeISO: new Date(serverTime).toISOString()
          };
          
          if (typeof callback === 'function') {
            callback(response);
          }
        } catch (error) {
          console.error('Error getting server time:', error);
          if (typeof callback === 'function') {
            callback({ error: 'Failed to get server time' });
          }
        }
      });

    socket.on('reset-game', async ({ betAmount }) => {
      try { 
        stopGameCalling(betAmount); 
        endGameCompletely(io,betAmount);
        activeGames.delete(betAmount); 
        await cleanupSessionsAndUpdateStats(io, betAmount, { betAmount }); // ✅ FIXED
      } catch (error: any) { socket.emit('error', { message: error.message }); }
    });

    socket.on('test-game', async ({ betAmount }) => {
      try { 
        stopGameCalling(betAmount); 
        endGameCompletely(io,betAmount);
        activeGames.delete(betAmount); 
        await cleanupSessionsAndUpdateStats(io, betAmount, { betAmount }); // ✅ FIXED
      } catch (error: any) { socket.emit('error', { message: error.message }); }
    });

    socket.on('disconnect', (reason) => console.log('Client disconnected:', socket.id, 'Reason:', reason));
    socket.on('error', (error) => console.error('Socket error:', error));
  });

  console.log('Socket.io server setup complete with corrected data synchronization');
}