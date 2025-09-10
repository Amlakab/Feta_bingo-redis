import mongoose, { Document, Schema } from 'mongoose';

export interface ITransaction extends Document {
  userId: Schema.Types.ObjectId;
  type: 'deposit' | 'withdrawal' | 'game_purchase' | 'winning';
  amount: number;
  status: 'pending' | 'completed' | 'failed';
  reference: string;
  description: string;
  transactionId?: string;
  senderPhone?: string;
  senderName?: string;
  receiverPhone?: string;
  receiverName?: string;
  method?: 'telebirr' | 'cbe';
  reason?: string;
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
}

const transactionSchema = new Schema<ITransaction>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  type: {
    type: String,
    required: true,
    enum: ['deposit', 'withdrawal', 'game_purchase', 'winning'],
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending',
  },
  reference: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  transactionId: {
    type: String,
    unique: true,
    sparse: true,
  },
  senderPhone: {
    type: String,
  },
  senderName: {
    type: String,
  },
  receiverPhone: {
    type: String,
  },
  receiverName: {
    type: String,
  },
  method: {
    type: String,
    enum: ['telebirr', 'cbe'],
  },
  reason: {
    type: String,
  },
  metadata: {
    type: Schema.Types.Mixed,
  },
}, {
  timestamps: true,
});

// Index for faster queries
transactionSchema.index({ userId: 1, type: 1 });
transactionSchema.index({ reference: 1 }, { unique: false });
transactionSchema.index({ createdAt: 1 });
transactionSchema.index({ status: 1 });

export default mongoose.model<ITransaction>('Transaction', transactionSchema);