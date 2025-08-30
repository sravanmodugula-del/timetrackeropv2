
import sql from 'mssql';
import { loadFmbOnPremConfig } from '../config/fmb-env.js';

let sessionPool: sql.ConnectionPool | null = null;

export class OptimizedSessionManager {
  private static instance: OptimizedSessionManager;
  private pool: sql.ConnectionPool | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000;

  private constructor() {}

  static getInstance(): OptimizedSessionManager {
    if (!OptimizedSessionManager.instance) {
      OptimizedSessionManager.instance = new OptimizedSessionManager();
    }
    return OptimizedSessionManager.instance;
  }

  async initializeSessionPool(): Promise<sql.ConnectionPool> {
    if (this.pool && this.pool.connected) {
      return this.pool;
    }

    const config = loadFmbOnPremConfig();
    
    const poolConfig: sql.config = {
      server: config.database.server,
      database: config.database.database,
      user: config.database.user,
      password: config.database.password,
      port: config.database.port,
      options: {
        encrypt: config.database.encrypt,
        trustServerCertificate: config.database.trustServerCertificate,
        enableArithAbort: true,
        // Optimized for session management workload
        connectTimeout: 15000,
        requestTimeout: 10000,
        // Connection pool optimized for sessions
        pool: {
          max: 8, // Dedicated session pool
          min: 2,
          idleTimeoutMillis: 30000,
          acquireTimeoutMillis: 30000,
          createTimeoutMillis: 30000,
          destroyTimeoutMillis: 5000,
          reapIntervalMillis: 1000,
          createRetryIntervalMillis: 2000
        }
      }
    };

    try {
      this.pool = new sql.ConnectionPool(poolConfig);
      
      this.pool.on('error', (err) => {
        console.error('🔴 [SESSION-POOL] Connection pool error:', err);
        this.handleConnectionError();
      });

      await this.pool.connect();
      await this.ensureSessionTable();
      
      console.log('✅ [SESSION-POOL] Optimized session pool initialized successfully');
      this.reconnectAttempts = 0;
      
      return this.pool;
    } catch (error) {
      console.error('🔴 [SESSION-POOL] Failed to initialize session pool:', error);
      await this.handleConnectionError();
      throw error;
    }
  }

  private async ensureSessionTable(): Promise<void> {
    if (!this.pool) return;

    try {
      const request = new sql.Request(this.pool);
      await request.query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='sessions' AND xtype='U')
        BEGIN
          CREATE TABLE sessions (
            sid NVARCHAR(255) NOT NULL PRIMARY KEY,
            session NTEXT NOT NULL,
            expires DATETIME NULL
          );
          
          -- Optimized indexes for session operations
          CREATE INDEX IX_sessions_expires ON sessions(expires) WHERE expires IS NOT NULL;
          CREATE INDEX IX_sessions_sid_expires ON sessions(sid, expires);
        END
      `);
      
      // Create cleanup job for expired sessions
      await request.query(`
        IF NOT EXISTS (SELECT * FROM msdb.dbo.sysjobs WHERE name = 'TimeTracker_SessionCleanup')
        BEGIN
          EXEC msdb.dbo.sp_add_job
            @job_name = 'TimeTracker_SessionCleanup',
            @enabled = 1,
            @description = 'Cleanup expired TimeTracker sessions';
            
          EXEC msdb.dbo.sp_add_jobstep
            @job_name = 'TimeTracker_SessionCleanup',
            @step_name = 'Delete_Expired_Sessions',
            @command = 'DELETE FROM sessions WHERE expires < GETDATE()';
            
          EXEC msdb.dbo.sp_add_schedule
            @schedule_name = 'Every_5_Minutes',
            @freq_type = 4,
            @freq_interval = 1,
            @freq_subday_type = 4,
            @freq_subday_interval = 5;
            
          EXEC msdb.dbo.sp_attach_schedule
            @job_name = 'TimeTracker_SessionCleanup',
            @schedule_name = 'Every_5_Minutes';
        END
      `);
      
      console.log('✅ [SESSION-POOL] Session table and cleanup job configured');
    } catch (error) {
      console.error('🔴 [SESSION-POOL] Failed to ensure session table:', error);
    }
  }

  private async handleConnectionError(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('🔴 [SESSION-POOL] Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
    
    console.log(`🟡 [SESSION-POOL] Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
    
    setTimeout(async () => {
      try {
        await this.initializeSessionPool();
      } catch (error) {
        console.error('🔴 [SESSION-POOL] Reconnection failed:', error);
      }
    }, delay);
  }

  async getPool(): Promise<sql.ConnectionPool | null> {
    return this.pool;
  }

  async closeSessionPool(): Promise<void> {
    if (this.pool) {
      try {
        await this.pool.close();
        this.pool = null;
        console.log('✅ [SESSION-POOL] Session pool closed successfully');
      } catch (error) {
        console.error('🔴 [SESSION-POOL] Error closing session pool:', error);
      }
    }
  }

  // Manual session cleanup method
  async cleanupExpiredSessions(): Promise<number> {
    if (!this.pool) return 0;

    try {
      const request = new sql.Request(this.pool);
      const result = await request.query('DELETE FROM sessions WHERE expires < GETDATE()');
      const deletedCount = result.rowsAffected[0] || 0;
      
      if (deletedCount > 0) {
        console.log(`🧹 [SESSION-CLEANUP] Cleaned up ${deletedCount} expired sessions`);
      }
      
      return deletedCount;
    } catch (error) {
      console.error('🔴 [SESSION-CLEANUP] Failed to cleanup expired sessions:', error);
      return 0;
    }
  }
}

export { OptimizedSessionManager };
