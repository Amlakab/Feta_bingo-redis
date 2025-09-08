// =============================
// File: src/socket/setupSocket.ts (refactored for Redis sessions)
// =============================
import { Server, Socket } from 'socket.io';
import User from '../models/User'; // keep using Mongo for users & wallet
import { GameSessionRepo, GameSessionDTO, SessionStatus } from '../repositories/redisGameSessionRepo';

interface AuthenticatedSocket extends Socket { userId?: string; }

// ---- Bingo calling logic (UNCHANGED) ----
interface GameState {
  betAmount: number;
  calledNumbers: string[];
  remainingNumbers: string[];
  isCalling: boolean;
  callingInterval?: NodeJS.Timeout;
}
const activeGames = new Map<number, GameState>();
function generateAllBingoNumbers(): string[] { const letters = ["B","I","N","G","O"]; const ranges = [{min:1,max:15},{min:16,max:30},{min:31,max:45},{min:46,max:60},{min:61,max:75}]; const all: string[] = []; letters.forEach((l,i)=>{ for(let n=ranges[i].min;n<=ranges[i].max;n++){ all.push(`${l}-${n}`);} }); return all; }
function shuffleNumbers(numbers: string[]): string[] { const a=[...numbers]; for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; }
function startGameCalling(io: Server, betAmount: number) { if (activeGames.has(betAmount)) { const g=activeGames.get(betAmount)!; if (g.isCalling) return; } const all=generateAllBingoNumbers(); const shuf=shuffleNumbers(all); const gs: GameState={ betAmount, calledNumbers:[], remainingNumbers:shuf, isCalling:true }; activeGames.set(betAmount, gs); gs.callingInterval=setInterval(()=>{ const game=activeGames.get(betAmount); if(!game||game.remainingNumbers.length===0){ stopGameCalling(betAmount); return; } const nextNumber=game.remainingNumbers[0]; game.calledNumbers.push(nextNumber); game.remainingNumbers=game.remainingNumbers.slice(1); io.emit('number-called',{ betAmount, number: nextNumber, calledNumbers: game.calledNumbers }); if(game.remainingNumbers.length===0){ stopGameCalling(betAmount);} }, 4000); }
function stopGameCalling(betAmount:number){ const g=activeGames.get(betAmount); if(g&&g.callingInterval){ clearInterval(g.callingInterval); g.isCalling=false; } }
function getGameState(betAmount:number){ return activeGames.get(betAmount); }
// -----------------------------------------

// Helper: attach user phones to sessions (replaces Mongoose populate)
async function enrichWithUserPhones(sessions: GameSessionDTO[]) {
  const uniqueUserIds = Array.from(new Set(sessions.map(s => s.userId)));
  const users = await Promise.all(uniqueUserIds.map(id => User.findById(id).select('phone')));
  const phoneMap = new Map<string, string>();
  users.forEach(u => { if (u) phoneMap.set(String(u._id), (u as any).phone); });
  return sessions.map(s => ({ ...s, userId: { _id: s.userId, phone: phoneMap.get(s.userId) || null } }));
}

export function setupSocket(io: Server) {
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = (socket.handshake as any).auth?.token || (socket.handshake.query as any).token;
      if (!token) return next(new Error('Authentication error'));
      socket.userId = socket.handshake.query.userId as string; // keep as-is
      next();
    } catch { next(new Error('Authentication error')); }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log('Client connected:', socket.id, 'User:', socket.userId);

    // === Fetch sessions ===
    socket.on('get-sessions', async (data: { betOptions?: number[]; betAmount?: number }) => {
      try {
        const betAmountIn = data.betOptions && data.betOptions.length ? data.betOptions : (data.betAmount !== undefined ? [data.betAmount] : undefined);
        const sessions = await GameSessionRepo.find({ betAmountIn, statusIn: ['ready','active','playing','blocked'] });
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
        if (userId !== socket.userId) { socket.emit('error', { message: 'Unauthorized' }); return; }

        // Ensure card not taken for this bet
        const existing = await GameSessionRepo.findOne({ cardNumber, betAmount, statusIn: ['ready','active','playing'] });
        if (existing) { socket.emit('error', { message: 'Card already taken' }); return; }

        // Wallet checks (Mongo User stays as-is)
        // const user = await User.findById(userId);
        // if (!user) { socket.emit('error', { message: 'User not found' }); return; }
        // if ((user as any).wallet < betAmount) { socket.emit('error', { message: 'Insufficient balance' }); return; }
        // (user as any).wallet -= betAmount; await user.save();

        const created = await GameSessionRepo.create({ userId, cardNumber, betAmount, status: 'active', createdAt });
        const populatedCreated = (await enrichWithUserPhones([created]))[0];

        // Broadcast all sessions (active/playing)
        const allSessions = await GameSessionRepo.find({ statusIn: ['ready','active','playing'] });
        const enrichedAll = await enrichWithUserPhones(allSessions);

        io.emit('session-created', populatedCreated);
        io.emit('sessions-updated', enrichedAll);
      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to create session' });
      }
    });

    // === Refund Wallet ===

      socket.on('clear-selected', async (data: { 
      betAmount: number;
      userId: string;
    }) => {
      try {
        const { betAmount, userId } = data;

        if (!userId) {
          socket.emit('error', { message: 'User ID is required' });
          return;
        }

        if (socket.userId !== userId) {
          socket.emit('error', { message: 'Unauthorized' });
          return;
        }

        // Find all sessions for this user and bet amount
        const sessions = await GameSessionRepo.find({
          betAmount,
          userId: userId,
          statusIn: ['active']
        });

        if (!sessions || sessions.length === 0) {
          socket.emit('error', { message: 'No sessions found' });
          return;
        }

        // Refund = betAmount × number of sessions
        //const totalRefund = betAmount * sessions.length;

        // Update user's wallet
         const user = await User.findById(userId);
        // if (user) {
        //   (user as any).wallet += totalRefund;
        //   await user.save();
        // }

        // Delete all sessions for this user with this bet amount
        await GameSessionRepo.deleteMany({ 
          betAmount, 
          userId: userId
        });

        // Stop game logic & cleanup for this bet amount
        stopGameCalling(betAmount);
        activeGames.delete(betAmount);

        //Send wallet update back to this user
        socket.emit('wallet-updated', user ? (user as any).wallet : 0);

        // Broadcast updated sessions list to everyone
        const updatedSessions = await GameSessionRepo.find({
          statusIn: ['active','ready']
        });
        const enriched = await enrichWithUserPhones(updatedSessions);
        io.emit('sessions-updated', enriched);

      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to refund wallet' });
      }
    });

    socket.on('refund-wallet', async (data: { 
      betAmount: number;
      userId: string;
    }) => {
      try {
        const { betAmount, userId } = data;

        if (!userId) {
          socket.emit('error', { message: 'User ID is required' });
          return;
        }

        if (socket.userId !== userId) {
          socket.emit('error', { message: 'Unauthorized' });
          return;
        }

        // Find all sessions for this user and bet amount
        const sessions = await GameSessionRepo.find({
          betAmount,
          userId: userId,
          statusIn: ['ready']
        });

        if (!sessions || sessions.length === 0) {
          socket.emit('error', { message: 'No sessions found' });
          return;
        }

        // Refund = betAmount × number of sessions
        const totalRefund = betAmount * sessions.length;

        // Update user's wallet
        const user = await User.findById(userId);
        if (user) {
          (user as any).wallet += totalRefund;
          await user.save();
        }

        // Delete all sessions for this user with this bet amount
        await GameSessionRepo.deleteMany({ 
          betAmount, 
          userId: userId
        });

        // Stop game logic & cleanup for this bet amount
        stopGameCalling(betAmount);
        activeGames.delete(betAmount);

        // Send wallet update back to this user
        socket.emit('wallet-updated', user ? (user as any).wallet : 0);

        // Broadcast updated sessions list to everyone
        const updatedSessions = await GameSessionRepo.find({
          statusIn: ['active', 'playing', 'ready']
        });
        const enriched = await enrichWithUserPhones(updatedSessions);
        io.emit('sessions-updated', enriched);

      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to refund wallet' });
      }
    });

    // === Fund Wallet ===
    socket.on('fund-wallet', async (data: { 
      betAmount: number;
      userId: string;
    }) => {
      try {
        const { betAmount, userId } = data;

        if (!userId) {
          socket.emit('error', { message: 'User ID is required' });
          return;
        }

        if (socket.userId !== userId) {
          socket.emit('error', { message: 'Unauthorized' });
          return;
        }

        // Find all sessions for this user and bet amount
        const sessions = await GameSessionRepo.find({
          betAmount,
          userId: userId,
          statusIn: ['active']
        });

        if (!sessions || sessions.length === 0) {
          socket.emit('error', { message: 'No sessions found' });
          return;
        }

        // Calculate total amount to deduct
        const totalAmount = betAmount * sessions.length;

        // Find user and check if they have sufficient balance
        const user = await User.findById(userId);
        if (!user) {
          socket.emit('error', { message: 'User not found' });
          return;
        }

        // Check if user has sufficient balance
        if ((user as any).wallet < totalAmount) {
          socket.emit('error', { message: 'Insufficient balance' });
          return;
        }

        // Subtract the amount from wallet
        (user as any).wallet -= totalAmount;
        await user.save();

        // Send wallet update back to this user
        socket.emit('wallet-updated', (user as any).wallet);

      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to process wallet funding' });
      }
    });

    // === Delete user session & refund ===
    socket.on('delete-session', async (data: { cardNumber: number; betAmount: number; }) => {
      try {
        const { cardNumber, betAmount } = data;
        if (!socket.userId) { socket.emit('error', { message: 'Unauthorized' }); return; }

        const session = await GameSessionRepo.findOne({ cardNumber, betAmount, userId: socket.userId });
        if (!session) { socket.emit('error', { message: 'Session not found' }); return; }

        const user = await User.findById(socket.userId);
        // if (user) { 
        //   //(user as any).wallet += betAmount; 
        //   //await user.save(); 
        // }

        await GameSessionRepo.deleteById(session._id);

        const updated = await GameSessionRepo.find({ statusIn: ['ready','active','playing'] });
        const enriched = await enrichWithUserPhones(updated);
        socket.emit('wallet-updated', user ? (user as any).wallet : 0);
        io.emit('sessions-updated', enriched);
      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to delete session' });
      }
    });

    // === Update single session status ===
    socket.on('update-session-status', async (data: { cardNumber: number; betAmount: number; status: string }) => {
      try {
        const { cardNumber, betAmount, status } = data;
        await GameSessionRepo.updateOne({ cardNumber, betAmount }, { status: status as SessionStatus });
        const updated = await GameSessionRepo.find({ statusIn: ['ready','active','playing'] });
        const enriched = await enrichWithUserPhones(updated);
        io.emit('sessions-updated', enriched);
      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to update session' });
      }
    });

    // === Update many by bet ===
    socket.on('update-session-status-by-bet', async (data: { betAmount: number; status: string }) => {
      try {
        const { betAmount, status } = data;
        await GameSessionRepo.updateMany({ betAmount, status: 'ready' }, { status: status as SessionStatus });
        const updated = await GameSessionRepo.find({ betAmount, statusIn: ['active','ready','playing'] });
        const enriched = await enrichWithUserPhones(updated);
        io.emit('sessions-updated', enriched);
      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to update sessions by bet amount' });
      }
    });

    // === Update status by userId and betAmount ===
    socket.on('update-session-status-by-user-bet', async (data: { 
      userId: string;
      betAmount: number; 
      status: string 
    }) => {
      try {
        const { userId, betAmount, status } = data;
        
        // Update session for specific user and bet amount
        await GameSessionRepo.updateMany(
          { userId, betAmount },
          { status: status as SessionStatus }
        );
        
        // Get updated sessions for this specific bet amount
        const updated = await GameSessionRepo.find({ 
          betAmount,
          statusIn: ['ready', 'active', 'playing'] 
        });
        
        const enriched = await enrichWithUserPhones(updated);
        io.emit('sessions-updated', enriched);
        
      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to update session by user and bet' });
      }
    });

    // === Update ready sessions by bet ===
    socket.on('update-ready-sessions-by-bet', async (data: { 
      betAmount: number; 
      status: string 
    }) => {
      try {
        const { betAmount, status } = data;
        
        // Update all sessions with this bet amount AND current status = 'ready'
        await GameSessionRepo.updateMany(
          { betAmount, status: 'ready' },
          { status: status as SessionStatus }
        );
        
        // Get all active/playing sessions
        const updated = await GameSessionRepo.find({ 
          statusIn: ['active', 'playing'] 
        });
        
        const enriched = await enrichWithUserPhones(updated);
        io.emit('sessions-updated', enriched);
        
      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to update ready sessions by bet amount' });
      }
    });

    // === Start/State/Stop/End/Reset game ===
    socket.on('start-game', (data: { betAmount: number }) => {
      try {
        const { betAmount } = data;
        startGameCalling(io, betAmount);
        const gameState = getGameState(betAmount);
        if (gameState) {
          socket.emit('game-state', { betAmount, calledNumbers: gameState.calledNumbers, currentNumber: gameState.calledNumbers[gameState.calledNumbers.length - 1] || "" });
        }
      } catch (error: any) { socket.emit('error', { message: error.message || 'Failed to start game' }); }
    });

    socket.on('get-game-state', (data: { betAmount: number }) => {
      try {
        const { betAmount } = data;
        const gameState = getGameState(betAmount);
        if (gameState) {
          socket.emit('game-state', { betAmount, calledNumbers: gameState.calledNumbers, currentNumber: gameState.calledNumbers[gameState.calledNumbers.length - 1] || "" });
        }
      } catch (error: any) { socket.emit('error', { message: error.message || 'Failed to get game state' }); }
    });

    socket.on('stop-game', (data: { betAmount: number }) => {
      try { 
        const { betAmount } = data; 
        stopGameCalling(betAmount); 
        activeGames.delete(betAmount); 
        io.emit('game-stopped', { betAmount }); 
      } catch (error: any) { socket.emit('error', { message: error.message || 'Failed to stop game' }); }
    });

  // Track winners temporarily per betAmount
const pendingWinners: Record<number, { userId: string; card: number }[]> = {};

socket.on(
  'end-game',
  async (data: { betAmount: number; winnerId: string; winnerCard: number; prizePool: number }) => {
    try {
      const { betAmount, winnerId, winnerCard, prizePool } = data;

      // Store winners temporarily for this betAmount
      if (!pendingWinners[betAmount]) {
        pendingWinners[betAmount] = [];
      }
      pendingWinners[betAmount].push({ userId: winnerId, card: winnerCard });

      // If this is the first winner for this betAmount, start 4-second timer
      if (pendingWinners[betAmount].length === 1) {
        stopGameCalling(betAmount);

        setTimeout(async () => {
          try {
            const winners = pendingWinners[betAmount] || [];
            delete pendingWinners[betAmount]; // cleanup

            activeGames.delete(betAmount);
            await GameSessionRepo.deleteMany({ betAmount });

            if (winners.length === 0) return;

            const prizePerWinner = prizePool / winners.length;

            // Update each winner's wallet
            for (const w of winners) {
              const user = await User.findById(w.userId);
              if (user) {
                (user as any).wallet += prizePerWinner;
                await user.save();

                // Send private notification to the winner
                io.to(w.userId).emit('winner-notification', {
                  message: `🎉 You won! There were ${winners.length} winners. Your prize: ${prizePerWinner}`,
                  prize: prizePerWinner,
                  totalWinners: winners.length,
                  card: w.card,
                });
              }
            }

            // Broadcast result to all players
            io.emit('game-ended', {
              winners: winners.map((w) => ({ id: w.userId, card: w.card })),
              prizePool,
              split: prizePerWinner,
              totalWinners: winners.length,
            });

            io.emit('sessions-updated', []);
          } catch (error: any) {
            socket.emit('error', { message: error.message || 'Failed to finalize game' });
          }
        }, 4000); // wait 4 seconds
      }
    } catch (error: any) {
      socket.emit('error', { message: error.message || 'Failed to end game' });
    }
  }
);


    socket.on('reset-game', async (data: { betAmount: number }) => {
      try {
        const { betAmount } = data;
        stopGameCalling(betAmount); 
        activeGames.delete(betAmount);
        await GameSessionRepo.deleteMany({ betAmount });
        // No broadcast per original code
      } catch (error: any) { socket.emit('error', { message: error.message || 'Failed to end game' }); }
    });

    socket.on('test-game', async (data: { betAmount: number }) => {
      try {
        const { betAmount } = data;
        stopGameCalling(betAmount); 
        activeGames.delete(betAmount);
        await GameSessionRepo.deleteMany({ betAmount });
        // No broadcast per original code
      } catch (error: any) { socket.emit('error', { message: error.message || 'Failed to end game' }); }
    });

    socket.on('disconnect', (reason) => { console.log('Client disconnected:', socket.id, 'Reason:', reason); });
    socket.on('error', (error) => { console.error('Socket error:', error); });
  });

  console.log('Socket.io server setup complete');
}