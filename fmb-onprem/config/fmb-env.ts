/**
 * On-Premises Environment Configuration
 * Loads FMB-specific environment variables and validates on-prem setup
 */

interface FmbOnPremConfig {
  database: {
    server: string;
    database: string;
    name: string;
    user: string;
    password: string;
    port: number;
    encrypt: boolean;
    trustServerCertificate: boolean;
    options: Record<string, any>;
  };
  saml: {
    entityId: string;
    ssoUrl: string;
    certificate: string;
    acsUrl: string;
  };
  app: {
    port: number;
    host: string;
    sessionSecret: string;
    nodeEnv: string;
  };
  session: {
    store: string;
    table: string;
  };
}

// Helper function to sanitize passwords for logging
function sanitizePassword(password: string): string {
  // Replace all characters except alphanumeric with '*'
  return password.replace(/./g, '*');
}

export function loadFmbOnPremConfig(): FmbOnPremConfig {
  // Skip validation during build process
  if (process.env.npm_lifecycle_event === 'build') {
    console.log('🔧 [FMB-ENV] Skipping environment validation during build');
    return createDefaultConfig();
  }

  // Validate required environment variables
  const requiredVars = [
    'FMB_DB_SERVER',
    'FMB_DB_NAME',
    'FMB_DB_USER',
    'FMB_DB_PASSWORD',
    'FMB_SAML_ENTITY_ID',
    'FMB_SAML_SSO_URL',
    'FMB_SAML_CERTIFICATE',
    'FMB_SESSION_SECRET'
  ];

  const missing = requiredVars.filter(varName => !process.env[varName]);
  if (missing.length > 0) {
    // In development, provide defaults instead of throwing
    if (process.env.NODE_ENV === 'development') {
      console.log('🟡 [FMB-ENV] Missing environment variables in development mode, using defaults');
      return createDefaultConfig();
    }
    throw new Error(`Missing required FMB environment variables: ${missing.join(', ')}`);
  }

  const dbPassword = process.env.FMB_DB_PASSWORD!;
  console.log(`Database password: ${sanitizePassword(dbPassword)}`); // Log sanitized password

  return {
    database: {
      server: process.env.FMB_DB_SERVER!,
      database: process.env.FMB_DB_NAME!,
      name: process.env.FMB_DB_NAME!,
      user: process.env.FMB_DB_USER!,
      password: dbPassword,
      port: parseInt(process.env.FMB_DB_PORT || '1433', 10),
      encrypt: process.env.FMB_DB_ENCRYPT !== 'false',
      trustServerCertificate: process.env.FMB_DB_TRUST_CERT === 'true',
      options: {
        enableArithAbort: true,
        connectTimeout: 30000,
        requestTimeout: 30000
      }
    },
    saml: {
      entityId: process.env.FMB_SAML_ENTITY_ID || 'https://timetracker.fmb.com',
      ssoUrl: process.env.FMB_SAML_SSO_URL || '',
      acsUrl: process.env.FMB_SAML_ACS_URL || 'https://timetracker.fmb.com/saml/acs',
      certificate: process.env.FMB_SAML_CERTIFICATE || ''
    },
    session: {
      store: 'mssql',
      table: 'sessions'
    },
    app: {
      port: parseInt(process.env.PORT || '3000', 10),
      host: process.env.HOST || '0.0.0.0',
      sessionSecret: process.env.FMB_SESSION_SECRET!,
      nodeEnv: process.env.NODE_ENV || 'production'
    }
  };
}

export function isFmbOnPremEnvironment(): boolean {
  // Never use FMB on-premises features in development mode
  if (process.env.NODE_ENV === 'development') {
    return false;
  }
  
  // Check if we're running in FMB on-premises environment
  // Only use FMB when explicitly configured in production
  return process.env.FMB_DEPLOYMENT === 'onprem' ||
         process.env.FMB_ONPREM === 'true' ||
         !!process.env.FMB_SAML_ENTITY_ID;
}

export function isActualOnPremDeployment(): boolean {
  // Only return true when actually deployed on Windows server with production environment
  return process.env.FMB_DEPLOYMENT === 'onprem' &&
         process.env.NODE_ENV === 'production' &&
         process.platform === 'win32';
}

export function shouldUseMSSql(): boolean {
  // Use MS SQL in production when FMB on-premises is enabled
  return process.env.NODE_ENV === 'production' && 
         isFmbOnPremEnvironment() && 
         process.env.FMB_DB_SERVER !== undefined;
}
// Helper function to create default config for development/build
function createDefaultConfig(): FmbOnPremConfig {
  return {
    database: {
      server: process.env.FMB_DB_SERVER || 'localhost',
      database: process.env.FMB_DB_NAME || 'timetracker',
      name: process.env.FMB_DB_NAME || 'timetracker',
      user: process.env.FMB_DB_USER || 'sa',
      password: process.env.FMB_DB_PASSWORD || 'password',
      port: parseInt(process.env.FMB_DB_PORT || '1433', 10),
      encrypt: process.env.FMB_DB_ENCRYPT !== 'false',
      trustServerCertificate: process.env.FMB_DB_TRUST_CERT === 'true',
      options: {
        enableArithAbort: true,
        connectTimeout: 30000,
        requestTimeout: 30000
      }
    },
    saml: {
      entityId: process.env.FMB_SAML_ENTITY_ID || 'https://timetracker.fmb.com',
      ssoUrl: process.env.FMB_SAML_SSO_URL || '',
      acsUrl: process.env.FMB_SAML_ACS_URL || 'https://timetracker.fmb.com/saml/acs',
      certificate: process.env.FMB_SAML_CERTIFICATE || ''
    },
    session: {
      store: 'mssql',
      table: 'sessions'
    },
    app: {
      port: parseInt(process.env.PORT || '3000', 10),
      host: process.env.HOST || '0.0.0.0',
      sessionSecret: process.env.FMB_SESSION_SECRET || process.env.SESSION_SECRET || 'dev-secret-key',
      nodeEnv: process.env.NODE_ENV || 'development'
    }
  };
}

