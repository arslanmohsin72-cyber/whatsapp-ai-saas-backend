import { WhatsAppSession } from '../models/WhatsAppSession.js';
import { QRWhatsAppConnector } from '../providers/whatsapp/QRWhatsAppConnector.js';
import { processIncomingWhatsAppMessage } from '../services/messageProcessor.js';
import socketService from '../services/socketService.js';
import { sendSuccess, sendError } from '../utils/responseHelper.js';
import logger from '../utils/logger.js';

// Global connector registry in memory per business
global.whatsappConnectors = global.whatsappConnectors || {};

export const getSessionStatus = async (req, res, next) => {
  try {
    let session = await WhatsAppSession.findOne({ businessId: req.businessId });
    if (!session) {
      session = await WhatsAppSession.create({
        businessId: req.businessId,
        status: 'disconnected'
      });
    }

    const activeConnector = global.whatsappConnectors[req.businessId];
    const liveStatus = activeConnector ? activeConnector.getStatus() : session.status;

    return sendSuccess(res, {
      ...session.toObject(),
      status: liveStatus
    });
  } catch (error) {
    next(error);
  }
};

export const connectWhatsApp = async (req, res, next) => {
  try {
    const businessId = req.businessId;

    // Check if connector is already running
    if (global.whatsappConnectors[businessId]) {
      const existing = global.whatsappConnectors[businessId];
      if (existing.getStatus() === 'connected') {
        return sendSuccess(res, { status: 'connected' }, 'WhatsApp already connected');
      }
    }

    const connector = new QRWhatsAppConnector(businessId);
    global.whatsappConnectors[businessId] = connector;

    // Pipe connector events to Socket.IO and DB
    connector.on('qr', (data) => {
      socketService.emitWhatsAppStatus(businessId, {
        status: 'qr_required',
        qrImage: data.qrImage
      });
    });

    connector.on('status', (data) => {
      socketService.emitWhatsAppStatus(businessId, data);
    });

    connector.on('message', async (data) => {
      await processIncomingWhatsAppMessage({
        businessId,
        from: data.from,
        text: data.text,
        messageId: data.messageId,
        whatsappConnector: connector
      });
    });

    // Start in background without blocking response
    connector.initialize().catch((err) => {
      logger.error(`Error in WhatsApp connector background run for ${businessId}:`, err);
    });

    return sendSuccess(res, { status: 'connecting' }, 'WhatsApp connection initialized. Awaiting QR code.');
  } catch (error) {
    next(error);
  }
};

export const disconnectWhatsApp = async (req, res, next) => {
  try {
    const businessId = req.businessId;
    const connector = global.whatsappConnectors[businessId];

    if (connector) {
      await connector.disconnect();
      delete global.whatsappConnectors[businessId];
    }

    await WhatsAppSession.findOneAndUpdate(
      { businessId },
      { $set: { status: 'disconnected', qrCodeString: '', connectedPhone: '' } }
    );

    socketService.emitWhatsAppStatus(businessId, { status: 'disconnected' });

    return sendSuccess(res, null, 'WhatsApp disconnected successfully');
  } catch (error) {
    next(error);
  }
};

export const simulateIncomingMessage = async (req, res, next) => {
  try {
    const { from, text } = req.body;
    if (!from || !text) {
      return sendError(res, 'Phone number (from) and text are required', 400);
    }

    const result = await processIncomingWhatsAppMessage({
      businessId: req.businessId,
      from: from.replace(/[^0-9]/g, ''),
      text: text.trim(),
      messageId: `sim_${Date.now()}`,
      whatsappConnector: global.whatsappConnectors[req.businessId] || null
    });

    return sendSuccess(res, result, 'Simulation processed successfully');
  } catch (error) {
    next(error);
  }
};

export default { getSessionStatus, connectWhatsApp, disconnectWhatsApp, simulateIncomingMessage };
