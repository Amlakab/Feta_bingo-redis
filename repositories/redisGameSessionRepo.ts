import redisClient, { ensureRedis } from "../lib/redisClient";
import { randomUUID } from "crypto";

export type SessionStatus = "active" | "playing" | "blocked" | "completed" | "ready";

export interface GameSessionDTO {
  _id: string;
  userId: string;
  cardNumber: number;
  betAmount: number;
  status: SessionStatus;
  createdAt: string;
}

// Keys & indexes
const ALL_SESSIONS_SET = "sessions:all";
const SESSION_KEY = (id: string) => `session:${id}`;
const BET_SET = (bet: number) => `sessions:bet:${bet}`;
const STATUS_SET = (s: SessionStatus) => `sessions:status:${s}`;
const USER_SET = (userId: string) => `sessions:user:${userId}`;

async function indexSession(session: GameSessionDTO) {
  await redisClient.sAdd(ALL_SESSIONS_SET, session._id);
  await redisClient.sAdd(BET_SET(session.betAmount), session._id);
  await redisClient.sAdd(STATUS_SET(session.status), session._id);
  await redisClient.sAdd(USER_SET(session.userId), session._id);
}

async function deindexSession(session: GameSessionDTO) {
  await redisClient.sRem(ALL_SESSIONS_SET, session._id);
  await redisClient.sRem(BET_SET(session.betAmount), session._id);
  await redisClient.sRem(STATUS_SET(session.status), session._id);
  await redisClient.sRem(USER_SET(session.userId), session._id);
}

async function readSession(id: string): Promise<GameSessionDTO | null> {
  const raw = await redisClient.get(SESSION_KEY(id));
  return raw ? (JSON.parse(raw) as GameSessionDTO) : null;
}

async function writeSession(session: GameSessionDTO) {
  await redisClient.set(SESSION_KEY(session._id), JSON.stringify(session));
}

export const GameSessionRepo = {
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

  async find(filter: { 
    betAmountIn?: number[]; 
    betAmount?: number; 
    userId?: string; 
    statusIn?: SessionStatus[];
    cardNumber?: number;
  } = {}) {
    await ensureRedis();

    let sessionIds: string[] = [];
    
    // If we have specific filters, use them to get IDs
    if (filter.betAmount !== undefined) {
      sessionIds = await redisClient.sMembers(BET_SET(filter.betAmount));
    } else if (filter.betAmountIn && filter.betAmountIn.length > 0) {
      const betPromises = filter.betAmountIn.map(bet => redisClient.sMembers(BET_SET(bet)));
      const betResults = await Promise.all(betPromises);
      sessionIds = Array.from(new Set(betResults.flat()));
    } else if (filter.userId) {
      sessionIds = await redisClient.sMembers(USER_SET(filter.userId));
    } else if (filter.statusIn && filter.statusIn.length > 0) {
      const statusPromises = filter.statusIn.map(status => redisClient.sMembers(STATUS_SET(status)));
      const statusResults = await Promise.all(statusPromises);
      sessionIds = Array.from(new Set(statusResults.flat()));
    } else {
      // Get all sessions if no specific filters
      sessionIds = await redisClient.sMembers(ALL_SESSIONS_SET);
    }

    // Read all sessions from the collected IDs
    const sessionsPromises = sessionIds.map(id => readSession(id));
    let sessions = (await Promise.all(sessionsPromises)).filter(Boolean) as GameSessionDTO[];

    // Apply additional filters that couldn't be handled by Redis sets
    if (filter.userId && !filter.userId) {
      sessions = sessions.filter(s => s.userId === filter.userId);
    }
    
    if (filter.cardNumber !== undefined) {
      sessions = sessions.filter(s => s.cardNumber === filter.cardNumber);
    }
    
    if (filter.statusIn && filter.statusIn.length > 0) {
      sessions = sessions.filter(s => filter.statusIn!.includes(s.status));
    }

    return sessions;
  },

  async findOne(filter: { 
    cardNumber?: number; 
    betAmount?: number; 
    userId?: string; 
    statusIn?: SessionStatus[] 
  }) {
    const sessions = await this.find({
      betAmount: filter.betAmount,
      statusIn: filter.statusIn
    });
    
    return sessions.find(session =>
      (filter.cardNumber === undefined || session.cardNumber === filter.cardNumber) &&
      (filter.userId === undefined || session.userId === filter.userId)
    ) || null;
  },

  async findById(id: string) {
    await ensureRedis();
    return await readSession(id);
  },

  async deleteById(id: string) {
    await ensureRedis();
    const session = await readSession(id);
    if (!session) return;
    await deindexSession(session);
    await redisClient.del(SESSION_KEY(id));
  },

  async updateOne(filter: { cardNumber?: number; betAmount?: number }, update: Partial<Pick<GameSessionDTO, "status">>) {
    const target = await this.findOne({ 
      cardNumber: filter.cardNumber, 
      betAmount: filter.betAmount 
    });
    
    if (!target) return null;

    const originalStatus = target.status;
    const updatedSession = { ...target, ...update };
    
    await writeSession(updatedSession);
    
    if (update.status && update.status !== originalStatus) {
      await redisClient.sRem(STATUS_SET(originalStatus), target._id);
      await redisClient.sAdd(STATUS_SET(updatedSession.status), target._id);
    }
    
    return updatedSession;
  },

  async updateMany(filter: { 
    betAmount?: number; 
    userId?: string;
    status?: SessionStatus 
  }, update: Partial<Pick<GameSessionDTO, "status">>) {
    const sessions = await this.find({ 
      betAmount: filter.betAmount, 
      userId: filter.userId,
      statusIn: filter.status ? [filter.status] : undefined 
    });
    
    for (const session of sessions) {
      const originalStatus = session.status;
      const updatedSession = { ...session, ...update };
      
      await writeSession(updatedSession);
      
      if (update.status && update.status !== originalStatus) {
        await redisClient.sRem(STATUS_SET(originalStatus), session._id);
        await redisClient.sAdd(STATUS_SET(updatedSession.status), session._id);
      }
    }
    
    return sessions.length;
  },

  async deleteMany(filter: { betAmount?: number; userId?: string }) {
    const sessions = await this.find({ 
      betAmount: filter.betAmount, 
      userId: filter.userId 
    });
    
    for (const session of sessions) {
      await deindexSession(session);
      await redisClient.del(SESSION_KEY(session._id));
    }
    
    return sessions.length;
  }
};