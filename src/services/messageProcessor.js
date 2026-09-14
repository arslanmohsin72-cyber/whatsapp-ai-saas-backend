import { Customer } from '../models/Customer.js';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { Booking } from '../models/Booking.js';
import { Notification } from '../models/Notification.js';
import { getBusinessContext } from './businessContextService.js';
import { GeminiProvider } from '../providers/ai/GeminiProvider.js';
import socketService from './socketService.js';
import logger from '../utils/logger.js';

const aiProvider = new GeminiProvider();

/**
 * Main Message Processor Hub
 * Handles the end-to-end lifecycle of an incoming WhatsApp message
 */
export const processIncomingWhatsAppMessage = async ({ businessId, from, text, messageId, whatsappConnector = null }) => {
  try {
    logger.info(`Processing WhatsApp message for business ${businessId} from ${from}: "${text}"`);

    // 1. Find or create Customer
    let customer = await Customer.findOne({ businessId, whatsappNumber: from });
    if (!customer) {
      customer = await Customer.create({
        businessId,
        whatsappNumber: from,
        name: `Customer ${from.slice(-4)}`,
        lastContactAt: new Date()
      });
      
      // Emit notification for new customer
      const newCustNotification = await Notification.create({
        businessId,
        title: 'New Customer',
        message: `New customer message received from +${from}`,
        type: 'customer_new',
        relatedId: customer._id
      });
      socketService.emitNotification(businessId, newCustNotification);
    } else {
      customer.lastContactAt = new Date();
      await customer.save();
    }

    // 2. Find or create active Conversation
    let conversation = await Conversation.findOne({ businessId, customerId: customer._id });
    if (!conversation) {
      conversation = await Conversation.create({
        businessId,
        customerId: customer._id,
        whatsappNumber: from,
        status: 'unread',
        lastMessageText: text,
        lastMessageAt: new Date(),
        lastMessageDirection: 'inbound',
        unreadCount: 1
      });
    } else {
      conversation.lastMessageText = text;
      conversation.lastMessageAt = new Date();
      conversation.lastMessageDirection = 'inbound';
      conversation.unreadCount += 1;
      await conversation.save();
    }

    // 3. Save incoming customer message
    const inboundMessage = await Message.create({
      businessId,
      conversationId: conversation._id,
      customerId: customer._id,
      direction: 'inbound',
      sender: 'customer',
      text,
      whatsappMessageId: messageId,
      deliveryStatus: 'delivered'
    });

    // Real-time broadcast to dashboard
    socketService.emitNewMessage(businessId, inboundMessage);
    socketService.emitConversationUpdate(businessId, conversation);

    // 4. Check Human Takeover / AI Disabled Status
    if (conversation.isHumanTakeover || !conversation.isAiEnabled) {
      logger.info(`Human takeover active for conversation ${conversation._id}. Skipping automated AI reply.`);
      return { success: true, aiReplied: false, reason: 'human_takeover' };
    }

    // 5. Load Business Context & Knowledge Base
    const businessContext = await getBusinessContext(businessId);

    // 6. Generate AI Response via Gemini
    const aiResult = await aiProvider.generateResponse({
      businessContext,
      customerMessage: text,
      conversationDraft: conversation.bookingDraft || {},
      customApiKey: null
    });

    logger.info(`AI generated response for ${from}: "${aiResult.text}" (Intent: ${aiResult.intent}, Lang: ${aiResult.language})`);

    // Update customer's detected language
    if (aiResult.language && customer.detectedLanguage !== aiResult.language) {
      customer.detectedLanguage = aiResult.language;
      await customer.save();
    }

    // 7. Handle Human Handover Trigger
    if (aiResult.triggerHandover) {
      conversation.isHumanTakeover = true;
      conversation.status = 'human_takeover';
      conversation.humanTakeoverReason = 'Customer requested human assistance';
      await conversation.save();

      const takeoverNotification = await Notification.create({
        businessId,
        title: 'Human Handover Requested',
        message: `Customer +${from} requested human support.`,
        type: 'human_requested',
        relatedId: conversation._id
      });
      socketService.emitNotification(businessId, takeoverNotification);
    }

    // 8. Handle Booking Draft Updates and Completion
    if (aiResult.bookingDraft) {
      conversation.bookingDraft = aiResult.bookingDraft;
      
      // If booking draft is complete, create the actual Booking record!
      if (aiResult.bookingDraft.isComplete) {
        const newBooking = await Booking.create({
          businessId,
          customerId: customer._id,
          conversationId: conversation._id,
          customerName: customer.name,
          whatsappNumber: from,
          serviceName: aiResult.bookingDraft.service || 'General Service',
          unitType: aiResult.bookingDraft.unitType || 'Standard',
          quantity: aiResult.bookingDraft.quantity || 1,
          bookingDate: aiResult.bookingDraft.date,
          preferredTime: aiResult.bookingDraft.time,
          fullAddress: aiResult.bookingDraft.address,
          city: customer.city || '',
          area: customer.area || '',
          status: 'pending',
          source: 'whatsapp_ai'
        });

        customer.totalBookings += 1;
        await customer.save();

        conversation.status = 'booking_in_progress';
        await conversation.save();

        const bookingNotification = await Notification.create({
          businessId,
          title: 'New Booking Request',
          message: `New booking received from ${customer.name} for ${newBooking.serviceName} on ${newBooking.bookingDate}`,
          type: 'booking_created',
          relatedId: newBooking._id
        });

        socketService.emitBookingUpdate(businessId, newBooking, 'booking:created');
        socketService.emitNotification(businessId, bookingNotification);
      } else {
        await conversation.save();
      }
    }

    // 9. Save AI Response in Database
    const outboundMessage = await Message.create({
      businessId,
      conversationId: conversation._id,
      customerId: customer._id,
      direction: 'outbound',
      sender: 'ai',
      text: aiResult.text,
      isAiGenerated: true,
      aiMeta: {
        model: businessContext.aiSettings?.model || 'gemini-2.5-flash',
        language: aiResult.language,
        intent: aiResult.intent,
        confidence: aiResult.confidence,
        latencyMs: aiResult.latencyMs
      },
      deliveryStatus: 'sent'
    });

    // 10. Send reply through WhatsApp Connector
    if (whatsappConnector) {
      await whatsappConnector.sendMessage(from, aiResult.text);
    }

    // Update conversation metadata
    conversation.lastMessageText = aiResult.text;
    conversation.lastMessageAt = new Date();
    conversation.lastMessageDirection = 'outbound';
    await conversation.save();

    // 11. Broadcast AI reply to dashboard in real-time
    socketService.emitNewMessage(businessId, outboundMessage);
    socketService.emitConversationUpdate(businessId, conversation);

    return {
      success: true,
      aiReplied: true,
      replyText: aiResult.text,
      intent: aiResult.intent,
      language: aiResult.language
    };
  } catch (error) {
    logger.error(`Error processing WhatsApp message for business ${businessId}:`, error);
    return { success: false, error: error.message };
  }
};

export default { processIncomingWhatsAppMessage };
