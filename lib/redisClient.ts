// =============================
// File: src/lib/redisClient.ts
// =============================
import { createClient } from "redis";

export const redis = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});

redis.on("error", (err) => {
  console.error("Redis Client Error:", err);
});

// Call connect() once at app bootstrap
export async function ensureRedis() {
  if (!redis.isOpen) {
    await redis.connect();
  }
}

// =============================
// File: src/repositories/redisGameSessionRepo.ts
// =============================
import { redis, ensureRedis } from "../lib/redisClient";
import { randomUUID } from "crypto";

export type SessionStatus = "active" | "playing" | "blocked" | "completed";

export interface GameSessionDTO {
  _id: string;                 // generated UUID
  userId: string;              // Mongo ObjectId string
  cardNumber: number;
  betAmount: number;
  status: SessionStatus;
  createdAt: string;           // ISO string
}

// Keys & indexes
const ALL_SESSIONS_SET = "sessions:all";                 // Set of session IDs
const SESSION_KEY = (id: string) => `session:${id}`;      // JSON value
const BET_SET = (bet: number) => `sessions:bet:${bet}`;   // Set of session IDs by betAmount
const STATUS_SET = (s: SessionStatus) => `sessions:status:${s}`; // Set of session IDs by status

async function indexSession(session: GameSessionDTO) {
  await redis.sAdd(ALL_SESSIONS_SET, session._id);
  await redis.sAdd(BET_SET(session.betAmount), session._id);
  await redis.sAdd(STATUS_SET(session.status), session._id);
}

async function deindexSession(session: GameSessionDTO) {
  await redis.sRem(ALL_SESSIONS_SET, session._id);
  await redis.sRem(BET_SET(session.betAmount), session._id);
  await redis.sRem(STATUS_SET(session.status), session._id);
}

async function readSession(id: string): Promise<GameSessionDTO | null> {
  const raw = await redis.get(SESSION_KEY(id));
  return raw ? (JSON.parse(raw) as GameSessionDTO) : null;
}

async function writeSession(session: GameSessionDTO) {
  await redis.set(SESSION_KEY(session._id), JSON.stringify(session));
}

export const GameSessionRepo = {
  // Create
  async create(data: Omit<GameSessionDTO, "_id" | "createdAt" | "status"> & { status?: SessionStatus; createdAt?: string }) {
    await ensureRedis();
    const now = new Date().toISOString();
    const session: GameSessionDTO = {
      _id: randomUUID(),
      userId: data.userId,
      cardNumber: data.cardNumber,
      betAmount: data.betAmount,
      status: data.status ?? "active",
      createdAt: data.createdAt ?? now,
    };
    await writeSession(session);
    await indexSession(session);
    return session;
  },

  // Find with simple filters
  async find(filter: { betAmountIn?: number[]; betAmount?: number; statusIn?: SessionStatus[] }) {
    await ensureRedis();

    let ids: string[] = [];

    if (filter.betAmount !== undefined) {
      ids = await redis.sMembers(BET_SET(filter.betAmount));
    } else if (filter.betAmountIn && filter.betAmountIn.length) {
      const memberSets = await Promise.all(filter.betAmountIn.map((b) => redis.sMembers(BET_SET(b))));
      ids = Array.from(new Set(memberSets.flat()));
    } else {
      ids = await redis.sMembers(ALL_SESSIONS_SET);
    }

    // Fetch and filter in memory by status
    const sessions = (await Promise.all(ids.map(readSession))).filter(Boolean) as GameSessionDTO[];

    const statusFiltered = filter.statusIn && filter.statusIn.length
      ? sessions.filter((s) => filter.statusIn!.includes(s.status))
      : sessions;

    // Sort by createdAt ASC to mimic typical DB default (adjust if you need)
    statusFiltered.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return statusFiltered;
  },

  // Find one by fields
  async findOne(filter: { cardNumber?: number; betAmount?: number; userId?: string; statusIn?: SessionStatus[] }) {
    const list = await this.find({ betAmount: filter.betAmount, statusIn: filter.statusIn });
    return list.find((s) =>
      (filter.cardNumber === undefined || s.cardNumber === filter.cardNumber) &&
      (filter.userId === undefined || s.userId === filter.userId)
    ) || null;
  },

  async findById(id: string) {
    await ensureRedis();
    return await readSession(id);
  },

  async deleteById(id: string) {
    await ensureRedis();
    const s = await readSession(id);
    if (!s) return;
    await deindexSession(s);
    await redis.del(SESSION_KEY(id));
  },

  async updateOne(filter: { cardNumber?: number; betAmount?: number }, update: Partial<Pick<GameSessionDTO, "status">>) {
    const target = await this.findOne({ cardNumber: filter.cardNumber, betAmount: filter.betAmount });
    if (!target) return null;

    const originalStatus = target.status;
    const changed = { ...target, ...update } as GameSessionDTO;
    await writeSession(changed);
    if (update.status && update.status !== originalStatus) {
      // move index between status sets
      await redis.sRem(STATUS_SET(originalStatus), changed._id);
      await redis.sAdd(STATUS_SET(changed.status), changed._id);
    }
    return changed;
  },

  async updateMany(filter: { betAmount?: number; status?: SessionStatus }, update: Partial<Pick<GameSessionDTO, "status">>) {
    const items = await this.find({ betAmount: filter.betAmount, statusIn: filter.status ? [filter.status] : undefined });
    for (const s of items) {
      const originalStatus = s.status;
      const changed: GameSessionDTO = { ...s, ...update } as GameSessionDTO;
      await writeSession(changed);
      if (update.status && update.status !== originalStatus) {
        await redis.sRem(STATUS_SET(originalStatus), s._id);
        await redis.sAdd(STATUS_SET(changed.status), s._id);
      }
    }
  },

  async deleteMany(filter: { betAmount?: number }) {
    const items = await this.find({ betAmount: filter.betAmount });
    for (const s of items) {
      await deindexSession(s);
      await redis.del(SESSION_KEY(s._id));
    }
  },
};

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
        const sessions = await GameSessionRepo.find({ betAmountIn, statusIn: ['active','playing','blocked'] as SessionStatus[] });
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
        const existing = await GameSessionRepo.findOne({ cardNumber, betAmount, statusIn: ['active','playing'] });
        if (existing) { socket.emit('error', { message: 'Card already taken' }); return; }

        // Wallet checks (Mongo User stays as-is)
        const user = await User.findById(userId);
        if (!user) { socket.emit('error', { message: 'User not found' }); return; }
        if ((user as any).wallet < betAmount) { socket.emit('error', { message: 'Insufficient balance' }); return; }
        (user as any).wallet -= betAmount; await user.save();

        const created = await GameSessionRepo.create({ userId, cardNumber, betAmount, status: 'active', createdAt });
        const populatedCreated = (await enrichWithUserPhones([created]))[0];

        // Broadcast all sessions (active/playing)
        const allSessions = await GameSessionRepo.find({ statusIn: ['active','playing'] });
        const enrichedAll = await enrichWithUserPhones(allSessions);

        io.emit('session-created', populatedCreated);
        io.emit('sessions-updated', enrichedAll);
      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to create session' });
      }
    });

    // === Delete user session & refund ===
    socket.on('delete-session', async (data: { cardNumber: number; betAmount: number; }) => {
      try {
        const { cardNumber, betAmount } = data;
        if (!socket.userId) { socket.emit('error', { message: 'Unauthorized' }); return; }

        const session = await GameSessionRepo.findOne({ cardNumber, betAmount, userId: socket.userId, statusIn: ['active'] });
        if (!session) { socket.emit('error', { message: 'Session not found' }); return; }

        const user = await User.findById(socket.userId);
        if (user) { (user as any).wallet += betAmount; await user.save(); }

        await GameSessionRepo.deleteById(session._id);

        const updated = await GameSessionRepo.find({ statusIn: ['active','playing'] });
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
        const updated = await GameSessionRepo.find({ statusIn: ['active','playing'] });
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
        await GameSessionRepo.updateMany({ betAmount, status: 'active' }, { status: status as SessionStatus });
        const updated = await GameSessionRepo.find({ betAmount, statusIn: ['active','playing'] });
        const enriched = await enrichWithUserPhones(updated);
        io.emit('sessions-updated', enriched);
      } catch (error: any) {
        socket.emit('error', { message: error.message || 'Failed to update sessions by bet amount' });
      }
    });

    // === Start/State/Stop/End/Reset game (UNCHANGED storage-wise except session deletions) ===
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
      try { const { betAmount } = data; stopGameCalling(betAmount); activeGames.delete(betAmount); io.emit('game-stopped', { betAmount }); }
      catch (error: any) { socket.emit('error', { message: error.message || 'Failed to stop game' }); }
    });

    socket.on('end-game', async (data: { betAmount: number; winnerId: string; winnerCard: number; prizePool: number }) => {
      try {
        const { betAmount, winnerId, winnerCard, prizePool } = data;
        stopGameCalling(betAmount); activeGames.delete(betAmount);
        await GameSessionRepo.deleteMany({ betAmount });
        io.emit('game-ended', { winnerId, winnerCard, prizePool });
        io.emit('sessions-updated', []);
      } catch (error: any) { socket.emit('error', { message: error.message || 'Failed to end game' }); }
    });

    socket.on('reset-game', async (data: { betAmount: number }) => {
      try {
        const { betAmount } = data;
        stopGameCalling(betAmount); activeGames.delete(betAmount);
        await GameSessionRepo.deleteMany({ betAmount });
        // No broadcast per original code
      } catch (error: any) { socket.emit('error', { message: error.message || 'Failed to end game' }); }
    });

    socket.on('disconnect', (reason) => { console.log('Client disconnected:', socket.id, 'Reason:', reason); });
    socket.on('error', (error) => { console.error('Socket error:', error); });
  });

  console.log('Socket.io server setup complete');
}
