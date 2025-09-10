import mongoose from 'mongoose';

const accountantSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true,
    trim: true
  },
  phoneNumber: {
    type: String,
    required: true,
    validate: {
      validator: function(v: string) {
        return /^\d{10,15}$/.test(v);
      },
      message: 'Phone number must be between 10-15 digits'
    }
  },
  accountNumber: {
    type: String,
    required: true,
    unique: true,
    validate: {
      validator: function(v: string) {
        return /^\d{9,18}$/.test(v);
      },
      message: 'Account number must be between 9-18 digits'
    }
  },
  bankName: {
    type: String,
    required: true,
    trim: true
  },
  isBlocked: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Indexes for better query performance
accountantSchema.index({ accountNumber: 1 });
accountantSchema.index({ phoneNumber: 1 });
accountantSchema.index({ isBlocked: 1 });
accountantSchema.index({ createdAt: 1 });

const Accountant = mongoose.model('Accountant', accountantSchema);

export default Accountant;