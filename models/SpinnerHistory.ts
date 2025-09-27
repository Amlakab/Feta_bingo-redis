// models/SpinnerHistory.ts
import mongoose, { Document, Schema } from 'mongoose';

export interface ISpinnerHistory extends Document {
  winnerId: mongoose.Types.ObjectId;
  winnerNumber: number;
  prizePool: number;
  numberOfPlayers: number;
  betAmount: number;
  selectedNumbers: number[];
  createdAt: Date;
}

const SpinnerHistorySchema: Schema = new Schema({
  winnerId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  winnerNumber: {
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
  selectedNumbers: [{
    type: Number,
    required: true
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model<ISpinnerHistory>('SpinnerHistory', SpinnerHistorySchema);