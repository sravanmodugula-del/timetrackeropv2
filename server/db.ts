
import { isFmbOnPremEnvironment } from '../fmb-onprem/config/fmb-env.js';

let storage: any = null;

export async function initializeDatabase() {
  // Skip database initialization during build process
  if (process.env.npm_lifecycle_event === 'build') {
    console.log('🔧 [DATABASE] Skipping database initialization during build process');
    storage = createFallbackStorage();
    return;
  }

  // In development mode, always use fallback storage
  if (process.env.NODE_ENV === 'development') {
    console.log('🔧 [DATABASE] Development mode: Using fallback storage (no database connection)');
    storage = createFallbackStorage();
    return;
  }

  // Only attempt MS SQL connection in production on-premises environment
  if (isFmbOnPremEnvironment() && process.env.NODE_ENV === 'production') {
    console.log('🔧 [DATABASE] Production on-premises mode: Attempting MS SQL Server connection...');
    try {
      // Dynamic import to avoid loading MS SQL dependencies in development
      const { initializeFmbDatabase, getFmbStorage } = await import('../fmb-onprem/config/fmb-database.js');
      
      // Initialize the database connection first
      await initializeFmbDatabase();
      
      // Get the storage instance
      storage = getFmbStorage();
      
      // Test the connection
      await storage.connect();
      
      console.log('✅ [DATABASE] MS SQL Server initialized and connected successfully');
    } catch (error) {
      console.error('🔴 [DATABASE] Failed to connect to MS SQL Server:', error?.message || 'Unknown error');
      
      // Enhanced error reporting for on-prem deployments
      if (error?.code === 'ESOCKET') {
        console.error('🔴 [DATABASE] Connection Error Details:');
        console.error('   - Cannot reach database server');
        console.error('   - Check network connectivity and firewall settings');
        console.error('   - Verify database server is running');
      } else if (error?.code === 'ELOGIN') {
        console.error('🔴 [DATABASE] Authentication Error:');
        console.error('   - Invalid database credentials');
        console.error('   - Check username and password');
      }
      
      console.log('🟡 [DATABASE] Database connection not established - application will run with limited functionality');
      storage = createFallbackStorage();
    }
  } else {
    console.log('🔧 [DATABASE] Standard production mode: Using fallback storage');
    storage = createFallbackStorage();
  }
}

function createFallbackStorage() {
  const dbUnavailableMessage = 'Database connection not established. Please check your database configuration.';
  
  return {
    // Connection methods
    async connect() { 
      console.log('📝 [FALLBACK-STORAGE] Using in-memory storage for development');
      return true; 
    },
    async disconnect() { return true; },
    
    // User methods
    async getUser() { throw new Error(dbUnavailableMessage); },
    async getUserByEmail() { throw new Error(dbUnavailableMessage); },
    async upsertUser() { throw new Error(dbUnavailableMessage); },
    
    // Project methods
    async getProjects() { return []; },
    async getProjectById() { return null; },
    async getProjectsByUserId() { return []; },
    async createProject() { throw new Error(dbUnavailableMessage); },
    async updateProject() { throw new Error(dbUnavailableMessage); },
    async deleteProject() { throw new Error(dbUnavailableMessage); },
    
    // Task methods
    async getTasks() { return []; },
    async getTaskById() { return null; },
    async getTasksByProjectId() { return []; },
    async createTask() { throw new Error(dbUnavailableMessage); },
    async updateTask() { throw new Error(dbUnavailableMessage); },
    async deleteTask() { throw new Error(dbUnavailableMessage); },
    
    // Time entry methods
    async getTimeEntries() { return []; },
    async getTimeEntryById() { return null; },
    async getTimeEntriesByUserId() { return []; },
    async getTimeEntriesByProjectId() { return []; },
    async createTimeEntry() { throw new Error(dbUnavailableMessage); },
    async updateTimeEntry() { throw new Error(dbUnavailableMessage); },
    async deleteTimeEntry() { throw new Error(dbUnavailableMessage); },
    
    // Employee methods
    async getEmployees() { return []; },
    async getEmployeeById() { return null; },
    async createEmployee() { throw new Error(dbUnavailableMessage); },
    async updateEmployee() { throw new Error(dbUnavailableMessage); },
    async deleteEmployee() { throw new Error(dbUnavailableMessage); },
    
    // Department methods
    async getDepartments() { return []; },
    async getDepartmentById() { return null; },
    async createDepartment() { throw new Error(dbUnavailableMessage); },
    async updateDepartment() { throw new Error(dbUnavailableMessage); },
    async deleteDepartment() { throw new Error(dbUnavailableMessage); },
    
    // Dashboard stats
    async getDashboardStats() {
      return {
        totalHours: 0,
        totalProjects: 0,
        totalEmployees: 0,
        recentActivity: []
      };
    }
  };
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    if (isFmbOnPremEnvironment() && process.env.NODE_ENV === 'production') {
      // Dynamic import to avoid loading MS SQL dependencies in development
      const { checkFmbDatabaseHealth } = await import('../fmb-onprem/config/fmb-database.js');
      return await checkFmbDatabaseHealth();
    }
    return true; // Always healthy in development
  } catch (error) {
    console.error('🔴 [DATABASE] Health check failed:', error);
    return false;
  }
}

export function getStorage() {
  return storage;
}

export async function closeDatabaseConnection() {
  if (storage && typeof storage.disconnect === 'function') {
    await storage.disconnect();
  }
}
