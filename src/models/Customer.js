import mongoose from 'mongoose';

const customerSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true
    },
    whatsappNumber: {
      type: String,
      required: [true, 'WhatsApp number is required'],
      trim: true
    },
    name: {
      type: String,
      default: 'Unknown Customer',
      trim: true
    },
    email: {
      type: String,
      default: '',
      trim: true,
      lowercase: true
    },
    preferredLanguage: {
      type: String,
      default: 'en'
    },
    detectedLanguage: {
      type: String,
      default: 'English'
    },
    address: {
      type: String,
      default: ''
    },
    city: {
      type: String,
      default: ''
    },
    area: {
      type: String,
      default: ''
    },
    postcode: {
      type: String,
      default: ''
    },
    status: {
      type: String,
      enum: ['active', 'lead', 'customer', 'blocked', 'archived'],
      default: 'active'
    },
    notes: {
      type: String,
      default: ''
    },
    tags: [
      {
        type: String,
        trim: true
      }
    ],
    lastContactAt: {
      type: Date,
      default: Date.now
    },
    totalBookings: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

customerSchema.index({ businessId: 1, whatsappNumber: 1 }, { unique: true });
customerSchema.index({ businessId: 1, lastContactAt: -1 });

export const Customer = mongoose.model('Customer', customerSchema);
export default Customer;
