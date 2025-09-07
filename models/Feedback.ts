// models/Feedback.ts
import mongoose, { Document, Schema } from 'mongoose';

export interface IFeedback extends Document {
  phone?: string;
  email?: string;
  name: string;
  subject: string;
  message: string;
  response?: string;
  status: 'pending' | 'responded';
  createdAt: Date;
  respondedAt?: Date;
}

const feedbackSchema = new Schema<IFeedback>({
  phone: {
    type: String,
    required: function(this: IFeedback) {
      return !this.email;
    },
    match: [/^09\d{8}$/, 'Please enter a valid Ethiopian phone number'],
    sparse: true
  },
  email: {
    type: String,
    required: function(this: IFeedback) {
      return !this.phone;
    },
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email'],
    sparse: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  subject: {
    type: String,
    required: true,
    enum: [
      'technical-support',
      'account-issues',
      'payment-issues',
      'game-suggestions',
      'partnership',
      'other'
    ]
  },
  message: {
    type: String,
    required: true,
    maxlength: 2000
  },
  response: {
    type: String,
    maxlength: 2000
  },
  status: {
    type: String,
    enum: ['pending', 'responded'],
    default: 'pending'
  },
  respondedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Update respondedAt when response is added
feedbackSchema.pre('save', function(next) {
  if (this.isModified('response') && this.response && this.response.length > 0) {
    this.status = 'responded';
    this.respondedAt = new Date();
  }
  next();
});

export default mongoose.model<IFeedback>('Feedback', feedbackSchema);