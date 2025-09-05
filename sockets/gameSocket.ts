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
    if (game.isCalling) return; // Already running
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

    if (game.remainingNumbers.length === 0) {
      stopGameCalling(betAmount);
    }
  }, 4000);
}

// Stop game
function stopGameCalling(betAmount: number) {
  const game = activeGames.get(betAmount);
  if (game && game.callingInterval) {
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

      // For now, use query userId
      socket.userId = socket.handshake.query.userId as string;
      next();
    } catch (error) {
      next(new Error("Authentication error"));
    }
  });

  io.on("connection", (socket: AuthenticatedSocket) => {
    console.log("Client connected:", socket.id, "User:", socket.userId);

    // Get sessions
    socket.on(
      "get-sessions",
      async (data: { betOptions?: number[]; betAmount?: number }) => {
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
      }
    );

    // Create session
    socket.on(
      "create-session",
      async (data: { userId: string; cardNumber: number; betAmount: number; createdAt?: string }) => {
        try {
          if (data.userId !== socket.userId) {
            socket.emit("error", { message: "Unauthorized" });
            return;
          }

          // Check if card already taken
          const existing = await GameSessionRepo.findOne({
            cardNumber: data.cardNumber,
            betAmount: data.betAmount,
            statusIn: ["active", "playing"],
            userId: undefined,
          });
          if (existing) {
            socket.emit("error", { message: "Card already taken" });
            return;
          }

          const user = await User.findById(socket.userId);
          if (!user) {
            socket.emit("error", { message: "User not found" });
            return;
          }
          if (user.wallet < data.betAmount) {
            socket.emit("error", { message: "Insufficient balance" });
            return;
          }

          user.wallet -= data.betAmount;
          await user.save();

          const session = await GameSessionRepo.create({
            userId: data.userId,
            cardNumber: data.cardNumber,
            betAmount: data.betAmount,
            createdAt: data.createdAt,
          });

          const allSessions = await GameSessionRepo.find({
            statusIn: ["active", "playing"],
          });

          io.emit("session-created", session);
          io.emit("sessions-updated", allSessions);
        } catch (error: any) {
          socket.emit("error", { message: error.message || "Failed to create session" });
        }
      }
    );

    // Refund wallet
    socket.on("refund-wallet", async (data: { betAmount: number }) => {
      try {
        if (!socket.userId) {
          socket.emit("error", { message: "Unauthorized" });
          return;
        }

        const sessions = await GameSessionRepo.find({
          betAmount: data.betAmount,
          statusIn: undefined,
        });
        const userSessions = sessions.filter((s) => s.userId === socket.userId);

        if (!userSessions.length) {
          socket.emit("error", { message: "No sessions found" });
          return;
        }

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

        const updatedSessions = await GameSessionRepo.find({
          statusIn: ["active", "playing"],
        });
        io.emit("sessions-updated", updatedSessions);
      } catch (error: any) {
        socket.emit("error", { message: error.message || "Failed to refund wallet" });
      }
    });

    // Delete session
    socket.on("delete-session", async (data: { cardNumber: number; betAmount: number }) => {
      try {
        if (!socket.userId) {
          socket.emit("error", { message: "Unauthorized" });
          return;
        }

        const session = await GameSessionRepo.findOne({
          cardNumber: data.cardNumber,
          betAmount: data.betAmount,
          userId: socket.userId,
          statusIn: ["active"],
        });
        if (!session) {
          socket.emit("error", { message: "Session not found" });
          return;
        }

        const user = await User.findById(socket.userId);
        if (user) {
          user.wallet += data.betAmount;
          await user.save();
        }

        await GameSessionRepo.deleteById(session._id);

        const updatedSessions = await GameSessionRepo.find({
          statusIn: ["active", "playing"],
        });

        socket.emit("wallet-updated", user?.wallet || 0);
        io.emit("sessions-updated", updatedSessions);
      } catch (error: any) {
        socket.emit("error", { message: error.message || "Failed to delete session" });
      }
    });

    // Update session status
    socket.on(
      "update-session-status",
      async (data: { cardNumber: number; betAmount: number; status: SessionStatus }) => {
        try {
          await GameSessionRepo.updateOne(
            { cardNumber: data.cardNumber, betAmount: data.betAmount },
            { status: data.status }
          );

          const updatedSessions = await GameSessionRepo.find({
            statusIn: ["active", "playing"],
          });
          io.emit("sessions-updated", updatedSessions);
        } catch (error: any) {
          socket.emit("error", { message: error.message || "Failed to update session" });
        }
      }
    );

    // Update session status by bet
    socket.on(
      "update-session-status-by-bet",
      async (data: { betAmount: number; status: SessionStatus }) => {
        try {
          await GameSessionRepo.updateMany(
            { betAmount: data.betAmount, status: "active" },
            { status: data.status }
          );

          const updatedSessions = await GameSessionRepo.find({
            betAmount: data.betAmount,
            statusIn: ["active", "playing"],
          });
          io.emit("sessions-updated", updatedSessions);
        } catch (error: any) {
          socket.emit("error", { message: error.message || "Failed to update sessions by bet amount" });
        }
      }
    );

    // Start game
    socket.on("start-game", (data: { betAmount: number }) => {
      try {
        startGameCalling(io, data.betAmount);
        const gameState = getGameState(data.betAmount);
        if (gameState) {
          socket.emit("game-state", {
            betAmount: data.betAmount,
            calledNumbers: gameState.calledNumbers,
            currentNumber: gameState.calledNumbers[gameState.calledNumbers.length - 1] || "",
          });
        }
      } catch (error: any) {
        socket.emit("error", { message: error.message || "Failed to start game" });
      }
    });

    // Get game state
    socket.on("get-game-state", (data: { betAmount: number }) => {
      try {
        const gameState = getGameState(data.betAmount);
        if (gameState) {
          socket.emit("game-state", {
            betAmount: data.betAmount,
            calledNumbers: gameState.calledNumbers,
            currentNumber: gameState.calledNumbers[gameState.calledNumbers.length - 1] || "",
          });
        }
      } catch (error: any) {
        socket.emit("error", { message: error.message || "Failed to get game state" });
      }
    });

    // Stop game
    socket.on("stop-game", (data: { betAmount: number }) => {
      try {
        stopGameCalling(data.betAmount);
        activeGames.delete(data.betAmount);
        io.emit("game-stopped", { betAmount: data.betAmount });
      } catch (error: any) {
        socket.emit("error", { message: error.message || "Failed to stop game" });
      }
    });

    // End game
    socket.on(
      "end-game",
      async (data: { betAmount: number; winnerId: string; winnerCard: number; prizePool: number }) => {
        try {
          stopGameCalling(data.betAmount);
          activeGames.delete(data.betAmount);

          await GameSessionRepo.deleteMany({ betAmount: data.betAmount });

          io.emit("game-ended", data);
          io.emit("sessions-updated", []);
        } catch (error: any) {
          socket.emit("error", { message: error.message || "Failed to end game" });
        }
      }
    );

    // Reset game
    socket.on("reset-game", async (data: { betAmount: number }) => {
      try {
        stopGameCalling(data.betAmount);
        activeGames.delete(data.betAmount);

        await GameSessionRepo.deleteMany({ betAmount: data.betAmount });
      } catch (error: any) {
        socket.emit("error", { message: error.message || "Failed to reset game" });
      }
    });

    socket.on("disconnect", (reason) => {
      console.log("Client disconnected:", socket.id, "Reason:", reason);
    });

    socket.on("error", (error) => {
      console.error("Socket error:", error);
    });
  });

  console.log("Socket.io server setup complete");
}
