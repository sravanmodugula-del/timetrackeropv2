import type { Express, RequestHandler } from "express";
import session from "express-session";
import passport from "passport";
import { Strategy as SamlStrategy } from "passport-saml";
import { getFmbStorage } from "../config/fmb-database.js";
import { loadFmbOnPremConfig } from "../config/fmb-env.js";
import connectMSSQLServer from 'connect-mssql-v2';

// Enhanced logging utility
function authLog(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const emoji = level === 'ERROR' ? '🔴' : level === 'WARN' ? '🟡' : level === 'INFO' ? '🔵' : '🟢';
  const logMessage = `${timestamp} ${emoji} [FMB-SAML] ${message}`;

  if (data) {
    console.log(logMessage, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
  } else {
    console.log(logMessage);
  }
}

export async function setupFmbSamlAuth(app: Express) {
  authLog('INFO', 'Initializing FMB SAML Authentication...');

  const config = loadFmbOnPremConfig();

  // Setup session management with memory store for now (MS SQL session store causes issues)
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week

  // Session middleware is already configured in the main app
  // No need to set up session middleware again here
  authLog('INFO', 'Using existing session middleware for FMB SAML authentication');

  app.use(passport.initialize());
  app.use(passport.session());

  // Configure SAML strategy
  const samlStrategy = new SamlStrategy(
    {
      entryPoint: config.saml.ssoUrl,
      issuer: config.saml.entityId,
      callbackUrl: config.saml.acsUrl,
      cert: config.saml.certificate,
      validateInResponseTo: false,
      disableRequestedAuthnContext: true,
      passReqToCallback: true, // Enable req parameter in callback
    },
    async (req: any, profile: any, done: any) => {
      try {
        // Extract user data from SAML response
        const userData = {
          id: profile.nameID,
          email: profile.nameID, // nameID is the email
          firstName: profile.firstName || '',
          lastName: profile.lastName || '',
          employeeId: profile.employeeId || '',
          department: profile.department || '',
          role: 'employee' as const // Default role, can be updated later
        };

        authLog('INFO', 'SAML authentication successful', {
          nameID: profile.nameID,
          email: userData.email,
          firstName: userData.firstName,
          lastName: userData.lastName
        });

        try {
          // Import storage functions
          const fmbStorage = getFmbStorage();

          // Ensure user exists in database
          await fmbStorage.upsertUser({
            id: userData.id,
            email: userData.email,
            firstName: userData.firstName,
            lastName: userData.lastName,
            role: userData.role,
            employeeId: userData.employeeId,
            department: userData.department
          });

          authLog('INFO', `User upserted in database: ${userData.email}`);

          // Store user data in session
          if (req.session) {
            req.session.user = userData;
          }

          return done(null, userData);
        } catch (dbError) {
          authLog('ERROR', `Failed to upsert user in database:`, dbError);
          // Continue with authentication even if database upsert fails
          return done(null, userData);
        }
      } catch (error) {
        authLog('ERROR', 'Error processing SAML profile:', error);
        return done(error);
      }
    }
  );

  passport.use(samlStrategy);

  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const fmbStorage = getFmbStorage();
      const user = await fmbStorage.getUser(id);

      // Handle cases where Replit and FMB SAML user structures might differ
      if (user && !user.sub && user.id) {
        // If 'user' object from FMB storage doesn't have 'sub' but has 'id',
        // and we are expecting 'sub' for Replit auth, map 'id' to 'sub'.
        // This ensures compatibility with endpoints expecting 'user.sub'.
        done(null, { ...user, sub: user.id });
      } else {
        done(null, user);
      }
    } catch (error) {
      done(error);
    }
  });

  // SAML routes
  app.get('/api/login', (req, res, next) => {
    authLog('INFO', 'SAML login initiated', { ip: req.ip, userAgent: req.get('User-Agent') });
    passport.authenticate('saml', {
      failureRedirect: '/login-error',
      failureFlash: true
    })(req, res, next);
  });

  app.post('/saml/acs', (req, res, next) => {
    authLog('INFO', 'SAML ACS callback received', { ip: req.ip, userAgent: req.get('User-Agent') });
    passport.authenticate('saml', {
      failureRedirect: '/login-error',
      successRedirect: '/'
    })(req, res, next);
  });

  app.get('/api/logout', (req, res) => {
    authLog('INFO', 'User logout initiated', { sessionId: req.sessionID });
    req.logout(() => {
      if (req.session) {
        req.session.destroy(() => {
          res.redirect('/');
        });
      } else {
        res.redirect('/');
      }
    });
  });

  // Error handling route for SAML failures
  app.get('/login-error', (req, res) => {
    authLog('ERROR', 'SAML authentication error page accessed', { ip: req.ip });
    res.status(401).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Authentication Error</title></head>
      <body>
        <h1>Authentication Failed</h1>
        <p>There was an error during the SAML authentication process.</p>
        <p><a href="/api/login">Try Again</a></p>
      </body>
      </html>
    `);
  });

  authLog('INFO', 'FMB SAML Authentication configured successfully');
}

export function getFmbSamlMetadata(): string {
  const config = loadFmbOnPremConfig();

  return `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" 
                     entityID="${config.saml.entityId}">
  <md:SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
                                Location="${config.saml.acsUrl}" index="0" isDefault="true"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>`;
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  try {
    authLog('DEBUG', `Authentication check for ${req.method} ${req.path}`, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      sessionId: req.sessionID,
      hasSession: !!req.session,
      isAuthenticated: req.isAuthenticated ? req.isAuthenticated() : false
    });

    // CRITICAL SECURITY: Only allow test user in development mode
    if (process.env.NODE_ENV === 'development' && (!req.isAuthenticated() || !req.user)) {
      authLog('DEBUG', 'Development mode: Creating test admin user');
      authLog('WARN', 'SECURITY: Authentication bypass active - DO NOT USE IN PRODUCTION');

      // Create a mock authenticated user for testing
      const testUser = {
        id: "test-admin-user",
        email: "admin@test.com",
        firstName: "Test",
        lastName: "Admin",
        profileImageUrl: null,
      };

      req.user = testUser;

      // Ensure the test user exists in database
      try {
        const fmbStorage = getFmbStorage();
        await fmbStorage.upsertUser(testUser);

        // In development mode, respect the current database role instead of forcing admin
        const currentUser = await fmbStorage.getUser("test-admin-user");
        const currentRole = currentUser?.role || "admin";

        // Only set admin role if user doesn't exist or has no role
        if (!currentUser || !currentUser.role) {
          await fmbStorage.updateUserRole("test-admin-user", "admin");
          authLog('INFO', 'Test admin user authenticated successfully');
        } else {
          authLog('INFO', `Test user authenticated with current role: ${currentRole}`);
        }
      } catch (dbError) {
        authLog('ERROR', 'Failed to setup test user:', dbError);
      }

      return next();
    }

    if (!req.isAuthenticated() || !req.user) {
      authLog('WARN', 'Unauthorized access attempt', {
        path: req.path,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        sessionId: req.sessionID
      });
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = req.user as any;
    authLog('DEBUG', 'User authenticated', {
      userId: user.id || 'unknown',
      email: user.email || 'unknown',
      sessionId: req.sessionID
    });

    authLog('DEBUG', 'Authentication successful, proceeding to next middleware');
    return next();

  } catch (error) {
    authLog('ERROR', 'Authentication middleware error:', {
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : error,
      request: {
        method: req.method,
        path: req.path,
        ip: req.ip,
        sessionId: req.sessionID
      }
    });
    return res.status(500).json({ message: "Internal server error" });
  }
};
