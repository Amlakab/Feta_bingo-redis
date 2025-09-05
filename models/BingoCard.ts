import mongoose, { Document, Schema } from 'mongoose';

export interface IBingoCard extends Document {
  gameId: Schema.Types.ObjectId;
  userId: Schema.Types.ObjectId;
  numbers: number[][];
  markedNumbers: number[];
  isBlocked: boolean;
  isWinner: boolean;
  purchaseTime: Date;
  createdAt: Date;
  updatedAt: Date;
}

const bingoCardSchema = new Schema<IBingoCard>({
  gameId: {
    type: Schema.Types.ObjectId,
    ref: 'Game',
    required: true,
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  numbers: [[{
    type: Number,
    min: 0,
    max: 75,
  }]],
  markedNumbers: [{
    type: Number,
    min: 1,
    max: 75,
  }],
  isBlocked: {
    type: Boolean,
    default: false,
  },
  isWinner: {
    type: Boolean,
    default: false,
  },
  purchaseTime: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// Index for faster queries
bingoCardSchema.index({ gameId: 1, userId: 1 });
bingoCardSchema.index({ userId: 1, isWinner: 1 });

export default mongoose.model<IBingoCard>('BingoCard', bingoCardSchema);