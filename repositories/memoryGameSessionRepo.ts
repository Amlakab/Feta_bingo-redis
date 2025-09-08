// repositories/memoryGameSessionRepo.ts
import { v4 as uuidv4 } from "uuid";

export type SessionStatus = "ready" | "active" | "playing" | "blocked";

export interface GameSessionDTO {
  _id: string;
  userId: string;
  cardNumber: number;
  betAmount: number;
  status: SessionStatus;
  createdAt: string;
}

const sessions = new Map<string, GameSessionDTO>();

export const MemoryGameSessionRepo = {
  async find(filter: {
    betAmountIn?: number[];
    userId?: string;
    statusIn?: SessionStatus[];
  }): Promise<GameSessionDTO[]> {
    return Array.from(sessions.values()).filter((s) => {
      if (filter.betAmountIn && !filter.betAmountIn.includes(s.betAmount)) return false;
      if (filter.userId && filter.userId !== s.userId) return false;
      if (filter.statusIn && !filter.statusIn.includes(s.status)) return false;
      return true;
    });
  },

  async findOne(filter: {
    cardNumber?: number;
    betAmount?: number;
    userId?: string;
    statusIn?: SessionStatus[];
  }): Promise<GameSessionDTO | null> {
    return (
      Array.from(sessions.values()).find((s) => {
        if (filter.cardNumber !== undefined && filter.cardNumber !== s.cardNumber) return false;
        if (filter.betAmount !== undefined && filter.betAmount !== s.betAmount) return false;
        if (filter.userId && filter.userId !== s.userId) return false;
        if (filter.statusIn && !filter.statusIn.includes(s.status)) return false;
        return true;
      }) || null
    );
  },

  async create(data: Omit<GameSessionDTO, "_id">): Promise<GameSessionDTO> {
    const session: GameSessionDTO = { _id: uuidv4(), ...data };
    sessions.set(session._id, session);
    return session;
  },

  async updateOne(filter: { cardNumber: number; betAmount: number }, update: Partial<GameSessionDTO>) {
    const s = Array.from(sessions.values()).find(
      (ss) => ss.cardNumber === filter.cardNumber && ss.betAmount === filter.betAmount
    );
    if (s) {
      Object.assign(s, update);
      sessions.set(s._id, s);
    }
  },

  async updateMany(filter: Partial<GameSessionDTO>, update: Partial<GameSessionDTO>) {
    for (const s of sessions.values()) {
      let match = true;
      for (const k in filter) {
        if ((s as any)[k] !== (filter as any)[k]) match = false;
      }
      if (match) {
        Object.assign(s, update);
        sessions.set(s._id, s);
      }
    }
  },

  async deleteById(id: string) {
    sessions.delete(id);
  },

  async deleteMany(filter: Partial<GameSessionDTO>) {
    for (const [id, s] of sessions.entries()) {
      let match = true;
      for (const k in filter) {
        if ((s as any)[k] !== (filter as any)[k]) match = false;
      }
      if (match) sessions.delete(id);
    }
  },
};
