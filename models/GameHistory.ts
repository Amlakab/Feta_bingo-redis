import mongoose, { Document, Schema } from 'mongoose';

export interface IGameHistory extends Document {
  winnerId: mongoose.Types.ObjectId;
  winnerCard: number;
  prizePool: number;
  numberOfPlayers: number;
  betAmount: number;
  createdAt: Date;
}

const GameHistorySchema: Schema = new Schema({
  winnerId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  winnerCard: {
    type: Number,
    required: true
  },
  prizePool: {
    type: Number,
    required: true
  },
  numberOfPlayers: {
    type: Number,
    required: true
  },
  betAmount: {
    type: Number,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model<IGameHistory>('GameHistory', GameHistorySchema);