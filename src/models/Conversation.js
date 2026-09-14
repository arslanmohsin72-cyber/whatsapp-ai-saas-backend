import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true
    },
    whatsappNumber: {
      type: String,
      required: true,
      trim: true
    },
    status: {
      type: String,
      enum: ['active', 'unread', 'booking_in_progress', 'human_takeover', 'resolved', 'closed'],
      default: 'active'
    },
    isHumanTakeover: {
      type: Boolean,
      default: false
    },
    isAiEnabled: {
      type: Boolean,
      default: true
    },
    humanTakeoverReason: {
      type: String,
      default: ''
    },
    lastMessageText: {
      type: String,
      default: ''
    },
    lastMessageAt: {
      type: Date,
      default: Date.now
    },
    lastMessageDirection: {
      type: String,
      enum: ['inbound', 'outbound'],
      default: 'inbound'
    },
    unreadCount: {
      type: Number,
      default: 0
    },
    assignedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    bookingDraft: {
      service: String,
      unitType: String,
      quantity: Number,
      date: String,
      time: String,
      address: String,
      city: String,
      area: String,
      postcode: String,
      notes: String,
      missingFields: [String]
    }
  },
  {
    timestamps: true
  }
);

conversationSchema.index({ businessId: 1, customerId: 1 }, { unique: true });
conversationSchema.index({ businessId: 1, status: 1, lastMessageAt: -1 });

export const Conversation = mongoose.model('Conversation', conversationSchema);
export default Conversation;
