import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config();

import { connectDB, getDBStatus } from './config/db.js';
import { sanitizeMiddleware } from './utils/sanitizer.js';
import { errorHandler } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { setupSocketIO } from './sockets/socketHandler.js';
import logger from './utils/logger.js';

// Import Routes
import authRoutes from './routes/authRoutes.js';
import businessRoutes from './routes/businessRoutes.js';
import serviceRoutes from './routes/serviceRoutes.js';
import serviceAreaRoutes from './routes/serviceAreaRoutes.js';
import faqRoutes from './routes/faqRoutes.js';
import policyRoutes from './routes/policyRoutes.js';
import workingHoursRoutes from './routes/workingHoursRoutes.js';
import customerRoutes from './routes/customerRoutes.js';
import conversationRoutes from './routes/conversationRoutes.js';
import messageRoutes from './routes/messageRoutes.js';
import bookingRoutes from './routes/bookingRoutes.js';
import whatsappRoutes from './routes/whatsappRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const CORS_ORIGIN = process.env.CORS_ORIGIN || FRONTEND_URL;

// 1. Security & Base Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false // Allows API to serve data flexibly
}));

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl) or matching origins
    if (!origin || origin === CORS_ORIGIN || origin.includes('localhost') || origin.includes('web.app') || origin.includes('firebaseapp.com')) {
      callback(null, true);
    } else {
      callback(new Error('Blocked by CORS security policy'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(sanitizeMiddleware);

// 2. Real-Time Socket.IO Server Setup
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling']
});

setupSocketIO(io);

// 3. Health Endpoint (Zero Secret Exposure)
app.get('/health', (req, res) => {
  const dbStatus = getDBStatus();
  const whatsappConnected = Object.values(global.whatsappConnectors || {}).some(
    (c) => c.getStatus() === 'connected'
  );

  return res.status(200).json({
    status: 'ok',
    service: 'whatsapp-ai-saas-backend',
    version: '1.0.0',
    database: dbStatus,
    whatsapp: whatsappConnected ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// 4. Mount REST API Routes (with general rate limiter)
app.use('/api', apiLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/business', businessRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/service-areas', serviceAreaRoutes);
app.use('/api/faqs', faqRoutes);
app.use('/api/policies', policyRoutes);
app.use('/api/working-hours', workingHoursRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/analytics', analyticsRoutes);

// 5. 404 Route Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Endpoint not found: ${req.method} ${req.originalUrl}`
  });
});

// 6. Centralized Error Handling Middleware
app.use(errorHandler);

// 7. Database Initialization & Server Startup
const startServer = async () => {
  await connectDB();

  server.listen(PORT, () => {
    logger.info(`========================================================`);
    logger.info(`WhatsApp AI SaaS Backend running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`Health Endpoint: http://localhost:${PORT}/health`);
    logger.info(`========================================================`);
  });
};

// Graceful Shutdown
const handleGracefulShutdown = async (signal) => {
  logger.info(`Received ${signal}. Gracefully shutting down...`);
  server.close(() => {
    logger.info('HTTP & Socket.IO server closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));

startServer();

export { app, server };
export default app;
