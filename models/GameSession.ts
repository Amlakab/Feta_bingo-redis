import mongoose, { Document, Schema } from 'mongoose';

export interface IGameSession extends Document {
  userId: mongoose.Types.ObjectId;
  cardNumber: number;
  betAmount: number;
  status: 'active' | 'playing' | 'blocked' | 'completed';
  createdAt: Date;
}

const GameSessionSchema: Schema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  cardNumber: {
    type: Number,
    required: true
  },
  betAmount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'playing', 'blocked', 'completed'],
    default: 'active'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model<IGameSession>('GameSession', GameSessionSchema);