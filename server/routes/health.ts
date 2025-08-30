import { Router } from 'express';
import { checkDatabaseHealth } from '../db.js';
import { isFmbOnPremEnvironment } from '../../fmb-onprem/config/fmb-env.js';

const router = Router();

router.get('/health', async (req, res) => {
  try {
    const dbHealth = await checkDatabaseHealth();
    const isOnPrem = isFmbOnPremEnvironment();

    const healthStatus = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: dbHealth ? 'connected' : 'disconnected',
      environment: process.env.NODE_ENV || 'development',
      deployment: isOnPrem ? 'on-premises' : 'cloud',
      version: process.env.npm_package_version || '1.0.0',
      platform: process.platform
    };

    res.status(dbHealth ? 200 : 503).json(healthStatus);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.get('/health/database', async (req, res) => {
  try {
    const isHealthy = await checkDatabaseHealth();
    const isOnPrem = isFmbOnPremEnvironment();

    let databaseType = 'fallback';
    let schemaValid = false;

    if (isOnPrem && process.env.NODE_ENV === 'production') {
      databaseType = 'mssql';

      try {
        // Dynamic import for MS SQL health checks
        const { checkFmbDatabaseHealth, validateDatabaseSchema } = await import('../../fmb-onprem/config/fmb-database.js');
        const mssqlHealth = await checkFmbDatabaseHealth();
        schemaValid = await validateDatabaseSchema();

        res.status(mssqlHealth && schemaValid ? 200 : 503).json({
          database: mssqlHealth && schemaValid ? 'healthy' : 'unhealthy',
          type: databaseType,
          connection: mssqlHealth ? 'connected' : 'disconnected',
          schema: schemaValid ? 'valid' : 'invalid',
          timestamp: new Date().toISOString(),
          server: process.env.FMB_DB_SERVER || 'unknown',
          deployment: 'on-premises'
        });
        return;
      } catch (error) {
        res.status(503).json({
          database: 'error',
          type: databaseType,
          connection: 'failed',
          schema: 'unknown',
          timestamp: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error',
          deployment: 'on-premises'
        });
        return;
      }
    }

    res.status(isHealthy ? 200 : 503).json({
      database: isHealthy ? 'healthy' : 'unhealthy',
      type: databaseType,
      connection: isHealthy ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
      deployment: isOnPrem ? 'on-premises' : 'cloud'
    });
  } catch (error) {
    res.status(500).json({
      database: 'error',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// MS SQL specific health endpoint for on-premises deployment
router.get('/health/mssql', async (req, res) => {
  try {
    if (!isFmbOnPremEnvironment() || process.env.NODE_ENV !== 'production') {
      res.status(404).json({
        error: 'MS SQL health check only available in on-premises production environment'
      });
      return;
    }

    const { checkFmbDatabaseHealth, validateDatabaseSchema } = await import('../../fmb-onprem/config/fmb-database.js');

    const [connectionHealth, schemaValid] = await Promise.all([
      checkFmbDatabaseHealth(),
      validateDatabaseSchema()
    ]);

    const config = {
      server: process.env.FMB_DB_SERVER || 'unknown',
      database: process.env.FMB_DB_NAME || 'unknown',
      port: process.env.FMB_DB_PORT || '1433'
    };

    res.status(connectionHealth && schemaValid ? 200 : 503).json({
      mssql: {
        connection: connectionHealth ? 'healthy' : 'unhealthy',
        schema: schemaValid ? 'valid' : 'invalid',
        server: config.server,
        database: config.database,
        port: config.port,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({
      mssql: {
        connection: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }
    });
  }
});

export default router;