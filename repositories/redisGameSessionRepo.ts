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

