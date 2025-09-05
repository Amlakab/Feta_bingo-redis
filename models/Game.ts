import mongoose, { Document, Schema } from 'mongoose';

export interface IGame extends Document {
  name: string;
  cardCount: number;
  cardPrice: number;
  status: 'waiting' | 'active' | 'completed';
  calledNumbers: number[];
  currentNumberIndex: number;
  numberSequence: number[];
  winner?: string;
  winningPattern?: string;
  startTime: Date;
  endTime?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const gameSchema = new Schema<IGame>({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  cardCount: {
    type: Number,
    required: true,
    enum: [20, 30, 40, 50, 100],
  },
  cardPrice: {
    type: Number,
    required: true,
    min: 1,
  },
  status: {
    type: String,
    enum: ['waiting', 'active', 'completed'],
    default: 'waiting',
  },
  calledNumbers: [{
    type: Number,
    min: 1,
    max: 75,
  }],
  currentNumberIndex: {
    type: Number,
    default: -1,
  },
  numberSequence: [{
    type: Number,
    min: 1,
    max: 75,
  }],
  winner: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },
  winningPattern: {
    type: String,
  },
  startTime: {
    type: Date,
    required: true,
  },
  endTime: {
    type: Date,
  },
}, {
  timestamps: true,
});

// Generate number sequence (1-75 shuffled) before saving
gameSchema.pre('save', function(next) {
  if (this.isNew && this.numberSequence.length === 0) {
    const numbers = Array.from({ length: 75 }, (_, i) => i + 1);
    // Fisher-Yates shuffle
    for (let i = numbers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
    }
    this.numberSequence = numbers;
  }
  next();
});

// Virtual for current number
gameSchema.virtual('currentNumber').get(function() {
  if (this.currentNumberIndex >= 0 && this.currentNumberIndex < this.numberSequence.length) {
    return this.numberSequence[this.currentNumberIndex];
  }
  return null;
});

export default mongoose.model<IGame>('Game', gameSchema);