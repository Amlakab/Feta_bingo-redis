import mongoose, { Document, Schema } from 'mongoose';

export interface IWinning extends Document {
  userId: Schema.Types.ObjectId;
  gameId: Schema.Types.ObjectId;
  cardId: Schema.Types.ObjectId;
  amount: number;
  pattern: string;
  createdAt: Date;
}

const winningSchema = new Schema<IWinning>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  gameId: {
    type: Schema.Types.ObjectId,
    ref: 'Game',
    required: true,
  },
  cardId: {
    type: Schema.Types.ObjectId,
    ref: 'BingoCard',
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  pattern: {
    type: String,
    required: true,
    enum: [
      'row-1', 'row-2', 'row-3', 'row-4', 'row-5',
      'col-1', 'col-2', 'col-3', 'col-4', 'col-5',
      'diagonal-1', 'diagonal-2', 'four-corners'
    ],
  },
}, {
  timestamps: true,
});

// Index for faster queries
winningSchema.index({ userId: 1 });
winningSchema.index({ gameId: 1 });
winningSchema.index({ createdAt: 1 });

export default mongoose.model<IWinning>('Winning', winningSchema);