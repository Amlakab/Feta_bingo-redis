// server/index.ts
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { createServer } from 'http';
import { Server } from 'socket.io';
import transactionRoutes from './routes/transactions';
import authRoutes from './routes/auth';
import gameRoutes from './routes/game';
import gamesRoutes from './routes/games';
import walletRoutes from './routes/wallet';
import adminRoutes from './routes/admin';
import agentRoutes from './routes/agent';
import userRoutes from './routes/user';
import { connectDB } from './config/database';
import { setupSocket } from './sockets/gameSocket';
import { errorHandler } from './middleware/errorHandler';

dotenv.config();

const app = express();
const server = createServer(app);

// Socket.io setup with proper configuration
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true
  },
  path: '/socket.io/', // Standard Socket.io path
  transports: ['websocket', 'polling'] // Enable both transports
});

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || "https://localhost:3000",
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/user', userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/games', gamesRoutes);
app.use('/api/transactions', transactionRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

// WebSocket endpoint for clients that need raw WebSocket
app.get('/ws', (req, res) => {
  res.status(400).json({ error: 'Use Socket.io client instead' });
});

// Socket.io setup
setupSocket(io);

// Error handling middleware
app.use(errorHandler);

// Connect to database
connectDB();

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket available at ${process.env.CLIENT_URL || 'http://localhost:3000'}`);
});