// =============================
// File: src/socket/setupSocket.ts (refactored for Redis sessions)
// =============================
import { Server, Socket } from 'socket.io';
import User from '../models/User'; // keep using Mongo for users & wallet
import { GameSessionRepo, GameSessionDTO, SessionStatus } from '../repositories/redisGameSessionRepo';

interface AuthenticatedSocket extends Socket {
  userId?: string;
}

// Game state interface
interface GameState {
  betAmount: number;
  calledNumbers: string[];
  remainingNumbers: string[];
  isCalling: boolean;
  callingInterval?: NodeJS.Timeout;
}

// Map to track active games
const activeGames = new Map<number, GameState>();

// Generate all BINGO numbers
function generateAllBingoNumbers(): string[] {
  const letters = ["B", "I", "N", "G", "O"];
  const ranges = [
    { min: 1, max: 15 },
    { min: 16, max: 30 },
    { min: 31, max: 45 },
    { min: 46, max: 60 },
    { min: 61, max: 75 },
  ];

  const allNumbers: string[] = [];
  letters.forEach((letter, idx) => {
    for (let num = ranges[idx].min; num <= ranges[idx].max; num++) {
      allNumbers.push(`${letter}-${num}`);
    }
  });
  return allNumbers;
}

// Shuffle numbers
function shuffleNumbers(numbers: string[]): string[] {
  const shuffled = [...numbers];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Start number calling
function startGameCalling(io: Server, betAmount: number) {
  if (activeGames.has(betAmount)) {
    const game = activeGames.get(betAmount)!;
    if (game.isCalling) return;
  }

  const allNumbers = generateAllBingoNumbers();
  const shuffledNumbers = shuffleNumbers(allNumbers);

  const gameState: GameState = {
    betAmount,
    calledNumbers: [],
    remainingNumbers: shuffledNumbers,
    isCalling: true,
  };

  activeGames.set(betAmount, gameState);

  gameState.callingInterval = setInterval(() => {
    const game = activeGames.get(betAmount);
    if (!game || game.remainingNumbers.length === 0) {
      stopGameCalling(betAmount);
      return;
    }

    const nextNumber = game.remainingNumbers.shift()!;
    game.calledNumbers.push(nextNumber);

    io.emit("number-called", {
      betAmount,
      number: nextNumber,
      calledNumbers: game.calledNumbers,
    });

    if (game.remainingNumbers.length === 0) stopGameCalling(betAmount);
  }, 4000);
}

// Stop game
function stopGameCalling(betAmount: number) {
  const game = activeGames.get(betAmount);
  if (game?.callingInterval) {
    clearInterval(game.callingInterval);
    game.isCalling = false;
  }
}

// Get current game state
function getGameState(betAmount: number) {
  return activeGames.get(betAmount);
}

// Socket setup
export function setupSocket(io: Server) {
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      if (!token) return next(new Error("Authentication error"));

      socket.userId = socket.handshake.query.userId as string;
      next();
    } catch {
      next(new Error("Authentication error"));
    }
  });

  io.on("connection", (socket: AuthenticatedSocket) => {
    console.log("Client connected:", socket.id, "User:", socket.userId);

    // ------------------ GET SESSIONS ------------------
    socket.on("get-sessions", async (data: { betOptions?: number[]; betAmount?: number }) => {
      try {
        const sessions = await GameSessionRepo.find({
          betAmountIn: data.betOptions,
          betAmount: data.betAmount,
          statusIn: ["active", "playing", "blocked"],
        });
        socket.emit("sessions-updated", sessions);
      } catch (error: any) {
        socket.emit("error", { message: error.message || "Failed to get sessions" });
      }
    });

    // ------------------ CREATE SESSION ------------------
    socket.on(
      "create-session",
      async (data: { userId: string; cardNumber: number; betAmount: number; createdAt?: string }) => {
        try {
          if (data.userId !== socket.userId) {
            socket.emit("error", { message: "Unauthorized" });
            return;
          }

          const existing = await GameSessionRepo.findOne({
            cardNumber: data.cardNumber,
            betAmount: data.betAmount,
            statusIn: ["active", "playing"],
          });
          if (existing) {
            socket.emit("error", { message: "Card already taken" });
            return;
          }

          const user = await User.findById(socket.userId);
          if (!user) throw new Error("User not found");
          if (user.wallet < data.betAmount) throw new Error("Insufficient balance");

          user.wallet -= data.betAmount;
          await user.save();

          const session = await GameSessionRepo.create({
            userId: data.userId,
            cardNumber: data.cardNumber,
            betAmount: data.betAmount,
            createdAt: data.createdAt,
          });

          const allSessions = await GameSessionRepo.find({ statusIn: ["active", "playing"] });
          io.emit("session-created", session);
          io.emit("sessions-updated", allSessions);
        } catch (error: any) {
          socket.emit("error", { message: error.message || "Failed to create session" });
        }
      }
    );

    // ------------------ REFUND WALLET ------------------
    socket.on("refund-wallet", async (data: { betAmount: number }) => {
      try {
        if (!socket.userId) throw new Error("Unauthorized");

        const sessions = await GameSessionRepo.find({ betAmount: data.betAmount });
        const userSessions = sessions.filter((s) => s.userId === socket.userId);

        if (!userSessions.length) throw new Error("No sessions found");

        const totalRefund = data.betAmount * userSessions.length;
        const user = await User.findById(socket.userId);
        if (user) {
          user.wallet += totalRefund;
          await user.save();
        }

        for (const s of userSessions) await GameSessionRepo.deleteById(s._id);

        stopGameCalling(data.betAmount);
        activeGames.delete(data.betAmount);

        socket.emit("wallet-updated", user?.wallet || 0);

        const updatedSessions = await GameSessionRepo.find({ statusIn: ["active", "playing"] });
        io.emit("sessions-updated", updatedSessions);
      } catch (error: any) {
        socket.emit("error", { message: error.message || "Failed to refund wallet" });
      }
    });

    // ------------------ DELETE SESSION ------------------
    socket.on("delete-session", async (data: { cardNumber: number; betAmount: number }) => {
      try {
        if (!socket.userId) throw new Error("Unauthorized");

        const session = await GameSessionRepo.findOne({
          cardNumber: data.cardNumber,
          betAmount: data.betAmount,
          userId: socket.userId,
          statusIn: ["active"],
        });
        if (!session) throw new Error("Session not found");

        const user = await User.findById(socket.userId);
        if (user) {
          user.wallet += data.betAmount;
          await user.save();
        }

        await GameSessionRepo.deleteById(session._id);

        const updatedSessions = await GameSessionRepo.find({ statusIn: ["active", "playing"] });
        socket.emit("wallet-updated", user?.wallet || 0);
        io.emit("sessions-updated", updatedSessions);
      } catch (error: any) {
        socket.emit("error", { message: error.message || "Failed to delete session" });
      }
    });

    // ------------------ UPDATE SESSION STATUS ------------------
    socket.on(
      "update-session-status",
      async (data: { cardNumber: number; betAmount: number; status: SessionStatus }) => {
        try {
          await GameSessionRepo.updateOne(
            { cardNumber: data.cardNumber, betAmount: data.betAmount },
            { status: data.status }
          );
          const updatedSessions = await GameSessionRepo.find({ statusIn: ["active", "playing"] });
          io.emit("sessions-updated", updatedSessions);
        } catch (error: any) {
          socket.emit("error", { message: error.message || "Failed to update session" });
        }
      }
    );

    // ------------------ UPDATE SESSION STATUS BY BET ------------------
    socket.on(
      "update-session-status-by-bet",
      async (data: { betAmount: number; status: SessionStatus }) => {
        try {
          await GameSessionRepo.updateMany({ betAmount: data.betAmount, status: "active" }, { status: data.status });
          const updatedSessions = await GameSessionRepo.find({
            betAmount: data.betAmount,
            statusIn: ["active", "playing"],
          });
          io.emit("sessions-updated", updatedSessions);
        } catch (error: any) {
          socket.emit("error", { message: error.message || "Failed to update sessions by bet" });
        }
      }
    );

    // ------------------ GAME CONTROL ------------------
    const emitGameState = (betAmount: number, socket?: AuthenticatedSocket) => {
      const game = getGameState(betAmount);
      if (game) {
        (socket || io).emit("game-state", {
          betAmount,
          calledNumbers: game.calledNumbers,
          currentNumber: game.calledNumbers[game.calledNumbers.length - 1] || "",
        });
      }
    };

    socket.on("start-game", (data: { betAmount: number }) => {
      startGameCalling(io, data.betAmount);
      emitGameState(data.betAmount, socket);
    });

    socket.on("get-game-state", (data: { betAmount: number }) => {
      emitGameState(data.betAmount, socket);
    });

    socket.on("stop-game", (data: { betAmount: number }) => {
      stopGameCalling(data.betAmount);
      activeGames.delete(data.betAmount);
      io.emit("game-stopped", { betAmount: data.betAmount });
    });

    socket.on(
      "end-game",
      async (data: { betAmount: number; winnerId: string; winnerCard: number; prizePool: number }) => {
        stopGameCalling(data.betAmount);
        activeGames.delete(data.betAmount);
        await GameSessionRepo.deleteMany({ betAmount: data.betAmount });
        io.emit("game-ended", data);
        io.emit("sessions-updated", []);
      }
    );

    socket.on("reset-game", async (data: { betAmount: number }) => {
      stopGameCalling(data.betAmount);
      activeGames.delete(data.betAmount);
      await GameSessionRepo.deleteMany({ betAmount: data.betAmount });
    });

    socket.on("disconnect", (reason) => console.log("Client disconnected:", socket.id, reason));
    socket.on("error", (error) => console.error("Socket error:", error));
  });

  console.log("Socket.io server setup complete");
}
