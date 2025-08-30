import express from "express";
import session from "express-session";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { checkDatabaseHealth } from "./db.js";
import { registerRoutes } from "./routes.js";
import { setupVite, serveStatic } from "./vite.js";
import { isFmbOnPremEnvironment, loadFmbOnPremConfig } from '../fmb-onprem/config/fmb-env.js';
import { initializeDatabase } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Enhanced logging utility
const LOG_LEVELS = {
  INFO: '🟢',
  WARN: '🟡',
  ERROR: '🔴',
  DEBUG: '🔍'
} as const;

function enhancedLog(level: keyof typeof LOG_LEVELS, category: string, message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} ${LOG_LEVELS[level]} [${category}] ${message}`;

  if (data) {
    console.log(logMessage, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
  } else {
    console.log(logMessage);
  }
}

// Global error handlers
process.on('uncaughtException', (error) => {
  enhancedLog('ERROR', 'PROCESS', 'Uncaught Exception:', {
    message: error.message,
    stack: error.stack,
    name: error.name
  });

  // Allow database connection errors to be handled gracefully
  if (error.message.includes('terminating connection') ||
      error.message.includes('database') ||
      error.message.includes('connection')) {
    enhancedLog('WARN', 'DATABASE', 'Database connection error detected - attempting recovery...');

    // Give some time for recovery attempts
    setTimeout(() => {
      enhancedLog('INFO', 'PROCESS', 'Database error recovery timeout reached');
    }, 10000);

    return; // Don't exit on database errors
  }

  enhancedLog('ERROR', 'PROCESS', 'Critical error - shutting down server');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  const isDbError = reason instanceof Error &&
    (reason.message.includes('terminating connection') ||
     reason.message.includes('database') ||
     reason.message.includes('connection'));

  enhancedLog(isDbError ? 'WARN' : 'ERROR', 'PROCESS', 'Unhandled Rejection:', {
    reason: reason instanceof Error ? {
      message: reason.message,
      stack: reason.stack,
      name: reason.name
    } : reason,
    promise: promise.toString(),
    isDatabaseError: isDbError
  });

  if (!isDbError) {
    enhancedLog('ERROR', 'PROCESS', 'Critical unhandled rejection - shutting down server');
    process.exit(1);
  } else {
    enhancedLog('INFO', 'PROCESS', 'Database error - continuing operation with connection recovery');
  }
});

// Session configuration
async function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 7 days
  const isProduction = process.env.NODE_ENV === 'production';
  const isOnPrem = isFmbOnPremEnvironment();

  // Check for session secret with better error handling
  const sessionSecret = process.env.SESSION_SECRET || process.env.FMB_SESSION_SECRET;
  if (!sessionSecret) {
    enhancedLog('ERROR', 'SESSION', 'SESSION_SECRET or FMB_SESSION_SECRET environment variable is required');
    throw new Error('SESSION_SECRET or FMB_SESSION_SECRET environment variable is required');
  }

  if (isProduction && sessionSecret.length < 32) {
    enhancedLog('WARN', 'SESSION', 'SESSION_SECRET should be at least 32 characters for production security');
  }

  enhancedLog('INFO', 'SESSION', `Session configured for ${isProduction ? 'production' : 'development'} mode`);

  const sessionConfig: any = {
    secret: sessionSecret,
    resave: true, // Force session save for SAML authentication
    saveUninitialized: true, // Save uninitialized sessions for SAML flow
    rolling: true,
    cookie: {
      httpOnly: isProduction,
      secure: false, // Set to false for development and on-premises without HTTPS
      maxAge: sessionTtl,
      sameSite: 'lax' as const
    },
    name: 'timetracker.sid'
  };

  // Use optimized MS SQL session store for on-premises production
  if (isProduction && isOnPrem) {
    try {
      const MSSQLStore = (await import('connect-mssql-v2')).default;
      const config = loadFmbOnPremConfig();

      // Enhanced session store configuration with proper error handling
      sessionConfig.store = new MSSQLStore({
        server: config.database.server,
        port: config.database.port,
        database: config.database.database,
        user: config.database.user,
        password: config.database.password,
        options: {
          encrypt: config.database.encrypt,
          trustServerCertificate: config.database.trustServerCertificate,
          enableArithAbort: true,
          connectTimeout: 30000,
          requestTimeout: 30000,
          // Connection pool settings optimized for sessions
          pool: {
            max: 10,
            min: 2,
            idleTimeoutMillis: 30000,
            acquireTimeoutMillis: 30000
          }
        },
        table: 'sessions',
        autoRemove: 'interval',
        autoRemoveInterval: 5, // Cleanup every 5 minutes
        schemaName: 'dbo',
        useUTC: true,
        disableTouch: false
      });

      enhancedLog('INFO', 'SESSION', 'MS SQL session store initialized successfully');
    } catch (error) {
      enhancedLog('ERROR', 'SESSION', 'Failed to initialize MS SQL session store:', {
        message: error?.message || 'Unknown error',
        code: error?.code || 'NO_CODE',
        name: error?.name || 'NO_NAME',
        stack: error?.stack || 'NO_STACK',
        originalError: error?.originalError || 'NO_ORIGINAL',
        number: error?.number || 'NO_NUMBER',
        severity: error?.severity || 'NO_SEVERITY',
        state: error?.state || 'NO_STATE',
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
      });
      enhancedLog('WARN', 'SESSION', 'Using memory session store as fallback');
    }
  } else {
    enhancedLog('INFO', 'SESSION', 'Using memory session store');
  }

  return session(sessionConfig);
}

async function createServer() {
  enhancedLog('INFO', 'SERVER', 'Starting TimeTracker application...');

  // Log environment detection
  if (process.env.NODE_ENV === 'development') {
    enhancedLog('INFO', 'SERVER', 'Development mode: All database connections disabled');
  } else if (isFmbOnPremEnvironment()) {
    enhancedLog('INFO', 'FMB-ONPREM', 'Production on-premises environment detected');
  } else {
    enhancedLog('INFO', 'SERVER', 'Standard production environment');
  }

  // Initialize database for all environments (never fail server startup)
  try {
    await initializeDatabase();
    enhancedLog('INFO', 'DATABASE', 'Database initialization completed successfully');
  } catch (error) {
    enhancedLog('WARN', 'DATABASE', 'Database initialization failed, continuing with fallback storage');
    enhancedLog('INFO', 'DATABASE', 'Application will run with limited functionality until database is available');
  }

  // Security middleware (production-ready)
  if (process.env.NODE_ENV === 'production') {
    // Trust proxy for production load balancers
    // app.set('trust proxy', 1); // This line should be after app initialization
  }

  const app = express();

  // Trust proxy for production load balancers
  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  // Basic security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        scriptSrc: ["'self'", "'unsafe-eval'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "ws:", "wss:"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // Session middleware with error handling
  try {
    const sessionMiddleware = await getSession();
    app.use(sessionMiddleware);
    enhancedLog('INFO', 'SERVER', 'Session middleware configured successfully');
  } catch (error) {
    enhancedLog('ERROR', 'SERVER', 'Failed to configure session middleware:', {
      message: error?.message || 'Unknown session error',
      stack: error?.stack || 'NO_STACK'
    });
    throw error;
  }

  // Body parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Health check endpoint
  app.get('/health', async (req, res) => {
    try {
      const dbHealthy = await checkDatabaseHealth();
      const isDevelopment = process.env.NODE_ENV === 'development';
      const isOnPrem = isFmbOnPremEnvironment();

      let databaseStatus = 'unknown';
      let statusMessage = '';

      if (isDevelopment && !isOnPrem) {
        databaseStatus = 'fallback';
        statusMessage = 'Running in development mode with fallback storage';
      } else if (dbHealthy) {
        databaseStatus = 'connected';
        statusMessage = 'Database connection established';
      } else {
        databaseStatus = 'disconnected';
        statusMessage = 'Database connection not established - check configuration';
      }

      const health = {
        status: (isDevelopment || dbHealthy) ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        database: databaseStatus,
        message: statusMessage,
        environment: process.env.NODE_ENV || 'development',
        onPremises: isOnPrem
      };

      // Return 200 for development mode even without database
      const statusCode = (isDevelopment || dbHealthy) ? 200 : 503;
      res.status(statusCode).json(health);
    } catch (error) {
      enhancedLog('ERROR', 'HEALTH', 'Health check failed:', error);
      res.status(503).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        message: 'Health check failed',
        error: error?.message || 'Unknown error'
      });
    }
  });

  // Register API routes
  await registerRoutes(app);

  // Setup frontend serving
  if (process.env.NODE_ENV === 'production') {
    serveStatic(app);
  } else {
    await setupVite(app);
  }

  const port = parseInt(process.env.PORT || '5000');
  const host = process.env.HOST || '0.0.0.0';

  try {
    // Start server with better error handling
    const server = app.listen(port, host, () => {
      enhancedLog('INFO', 'SERVER', `Server running on http://${host}:${port}`);
      enhancedLog('INFO', 'SERVER', `Environment: ${process.env.NODE_ENV || 'development'}`);

      if (isFmbOnPremEnvironment()) {
        enhancedLog('INFO', 'FMB-ONPREM', 'On-premises deployment active');
      }
    });

    // Handle server errors
    server.on('error', (error: any) => {
      enhancedLog('ERROR', 'SERVER', 'Server error event:', {
        message: error?.message || 'Unknown server error',
        code: error?.code || 'NO_CODE',
        errno: error?.errno || 'NO_ERRNO',
        syscall: error?.syscall || 'NO_SYSCALL',
        address: error?.address || 'NO_ADDRESS',
        port: error?.port || 'NO_PORT',
        stack: error?.stack || 'NO_STACK'
      });

      if (error?.code === 'EADDRINUSE') {
        enhancedLog('ERROR', 'SERVER', `Port ${port} is already in use. Please choose a different port.`);
      }

      process.exit(1);
    });

  } catch (error) {
    enhancedLog('ERROR', 'SERVER', 'Failed to start server (catch block):', {
      message: error?.message || 'Unknown error',
      name: error?.name || 'Unknown',
      code: error?.code || 'NO_CODE',
      stack: error?.stack || 'NO_STACK',
      fullError: error
    });

    // Don't exit on database connection errors in development
    if (process.env.NODE_ENV === 'development' &&
        error?.message?.includes('database')) {
      enhancedLog('WARN', 'SERVER', 'Database error in development - continuing without database');
      return;
    }

    process.exit(1);
  }
}

createServer().catch((error) => {
  enhancedLog('ERROR', 'SERVER', 'Failed to start server:', error);
  process.exit(1);
});
