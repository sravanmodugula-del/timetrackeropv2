
import session from 'express-session';
import { loadFmbOnPremConfig } from '../fmb-onprem/config/fmb-env.js';
import sql from 'mssql';

export class CustomMSSQLStore extends session.Store {
  private pool: sql.ConnectionPool | null = null;

  constructor() {
    super();
    this.initializePool();
  }

  private async initializePool() {
    try {
      const config = loadFmbOnPremConfig();
      
      this.pool = new sql.ConnectionPool({
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
          requestTimeout: 30000
        },
        pool: {
          max: 5,
          min: 1,
          idleTimeoutMillis: 30000
        }
      });

      await this.pool.connect();
      await this.ensureSessionTable();
      console.log('✅ Custom MS SQL session store initialized');
    } catch (error) {
      console.error('🔴 Failed to initialize custom session store:', error);
      this.pool = null;
    }
  }

  private async ensureSessionTable() {
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
          CREATE INDEX IX_sessions_expires ON sessions(expires);
        END
      `);
    } catch (error) {
      console.error('🔴 Failed to ensure session table:', error);
    }
  }

  async get(sid: string, callback: (err?: any, session?: session.SessionData | null) => void) {
    if (!this.pool) {
      return callback(new Error('Database not available'));
    }

    try {
      const request = new sql.Request(this.pool);
      request.input('sid', sql.NVarChar, sid);
      
      const result = await request.query('SELECT session FROM sessions WHERE sid = @sid AND (expires IS NULL OR expires > GETDATE())');
      
      if (result.recordset.length === 0) {
        return callback(null, null);
      }

      const sessionData = JSON.parse(result.recordset[0].session);
      callback(null, sessionData);
    } catch (error) {
      callback(error);
    }
  }

  async set(sid: string, session: session.SessionData, callback?: (err?: any) => void) {
    if (!this.pool) {
      return callback?.(new Error('Database not available'));
    }

    try {
      const request = new sql.Request(this.pool);
      const expires = session.cookie?.expires ? new Date(session.cookie.expires) : null;
      
      request.input('sid', sql.NVarChar, sid);
      request.input('session', sql.NText, JSON.stringify(session));
      request.input('expires', sql.DateTime, expires);

      await request.query(`
        IF EXISTS (SELECT 1 FROM sessions WHERE sid = @sid)
          UPDATE sessions SET session = @session, expires = @expires WHERE sid = @sid
        ELSE
          INSERT INTO sessions (sid, session, expires) VALUES (@sid, @session, @expires)
      `);

      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  async destroy(sid: string, callback?: (err?: any) => void) {
    if (!this.pool) {
      return callback?.(new Error('Database not available'));
    }

    try {
      const request = new sql.Request(this.pool);
      request.input('sid', sql.NVarChar, sid);
      
      await request.query('DELETE FROM sessions WHERE sid = @sid');
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  async touch(sid: string, session: session.SessionData, callback?: (err?: any) => void) {
    if (!this.pool) {
      return callback?.(new Error('Database not available'));
    }

    try {
      const request = new sql.Request(this.pool);
      const expires = session.cookie?.expires ? new Date(session.cookie.expires) : null;
      
      request.input('sid', sql.NVarChar, sid);
      request.input('expires', sql.DateTime, expires);

      await request.query('UPDATE sessions SET expires = @expires WHERE sid = @sid');
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  async length(callback: (err: any, length?: number) => void) {
    if (!this.pool) {
      return callback(new Error('Database not available'));
    }

    try {
      const request = new sql.Request(this.pool);
      const result = await request.query('SELECT COUNT(*) as count FROM sessions WHERE expires IS NULL OR expires > GETDATE()');
      callback(null, result.recordset[0].count);
    } catch (error) {
      callback(error);
    }
  }

  async clear(callback?: (err?: any) => void) {
    if (!this.pool) {
      return callback?.(new Error('Database not available'));
    }

    try {
      const request = new sql.Request(this.pool);
      await request.query('DELETE FROM sessions');
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }
}
