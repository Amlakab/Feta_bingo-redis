import mongoose from 'mongoose';

const gameSchema = new mongoose.Schema({
  betAmount: {
    type: Number,
    required: true,
    min: 1,
    max: 10000
  }
}, {
  timestamps: true // This adds createdAt and updatedAt automatically
});

// Index for better query performance
gameSchema.index({ betAmount: 1 });
gameSchema.index({ createdAt: 1 });

const Games = mongoose.model('Games', gameSchema);

export default Games;