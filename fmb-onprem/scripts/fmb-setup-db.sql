
-- =============================================================================
-- FMB TimeTracker Database Setup for MS SQL Server
-- Target: HUB-SQL1TST-LIS
-- =============================================================================

USE timetracker;
GO

-- =============================================================================
-- Drop existing objects in correct order (dependencies first)
-- =============================================================================

-- Drop triggers first
IF OBJECT_ID('TR_users_update', 'TR') IS NOT NULL DROP TRIGGER TR_users_update;
IF OBJECT_ID('TR_organizations_update', 'TR') IS NOT NULL DROP TRIGGER TR_organizations_update;
IF OBJECT_ID('TR_employees_update', 'TR') IS NOT NULL DROP TRIGGER TR_employees_update;
IF OBJECT_ID('TR_departments_update', 'TR') IS NOT NULL DROP TRIGGER TR_departments_update;
IF OBJECT_ID('TR_projects_update', 'TR') IS NOT NULL DROP TRIGGER TR_projects_update;
IF OBJECT_ID('TR_tasks_update', 'TR') IS NOT NULL DROP TRIGGER TR_tasks_update;
IF OBJECT_ID('TR_timeentries_update', 'TR') IS NOT NULL DROP TRIGGER TR_timeentries_update;

-- Drop all foreign key constraints first
DECLARE @sql NVARCHAR(MAX) = '';
SELECT @sql = @sql + 'ALTER TABLE ' + QUOTENAME(TABLE_SCHEMA) + '.' + QUOTENAME(TABLE_NAME) 
                  + ' DROP CONSTRAINT ' + QUOTENAME(CONSTRAINT_NAME) + ';' + CHAR(13)
FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
WHERE CONSTRAINT_TYPE = 'FOREIGN KEY' 
  AND TABLE_CATALOG = 'timetracker';

IF @sql <> ''
BEGIN
    EXEC sp_executesql @sql;
END
GO

-- Drop tables in reverse dependency order
IF OBJECT_ID('time_entries', 'U') IS NOT NULL DROP TABLE time_entries;
IF OBJECT_ID('project_employees', 'U') IS NOT NULL DROP TABLE project_employees;
IF OBJECT_ID('tasks', 'U') IS NOT NULL DROP TABLE tasks;
IF OBJECT_ID('projects', 'U') IS NOT NULL DROP TABLE projects;
IF OBJECT_ID('departments', 'U') IS NOT NULL DROP TABLE departments;
IF OBJECT_ID('employees', 'U') IS NOT NULL DROP TABLE employees;
IF OBJECT_ID('organizations', 'U') IS NOT NULL DROP TABLE organizations;
IF OBJECT_ID('users', 'U') IS NOT NULL DROP TABLE users;
GO

-- =============================================================================
-- Core Tables (in dependency order)
-- =============================================================================

-- Users (base table with no dependencies)
CREATE TABLE users (
    id NVARCHAR(255) PRIMARY KEY,
    email NVARCHAR(255) NOT NULL UNIQUE,
    first_name NVARCHAR(255) NOT NULL,
    last_name NVARCHAR(255) NOT NULL,
    profile_image_url NVARCHAR(MAX),
    role NVARCHAR(50) NOT NULL DEFAULT 'employee',
    organization_id NVARCHAR(255),
    department NVARCHAR(255),
    is_active BIT NOT NULL DEFAULT 1,
    last_login_at DATETIME2,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    updated_at DATETIME2 NOT NULL DEFAULT GETDATE()
);

-- Organizations (depends on users)
CREATE TABLE organizations (
    id NVARCHAR(255) PRIMARY KEY,
    name NVARCHAR(255) NOT NULL,
    description NVARCHAR(MAX),
    user_id NVARCHAR(255) NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    updated_at DATETIME2 NOT NULL DEFAULT GETDATE()
);

-- Employees (depends on users)
CREATE TABLE employees (
    id NVARCHAR(255) PRIMARY KEY,
    employee_id NVARCHAR(255) NOT NULL UNIQUE,
    first_name NVARCHAR(255) NOT NULL,
    last_name NVARCHAR(255) NOT NULL,
    department NVARCHAR(255) NOT NULL,
    user_id NVARCHAR(255),
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    updated_at DATETIME2 NOT NULL DEFAULT GETDATE()
);

-- Departments (depends on organizations and employees)
CREATE TABLE departments (
    id NVARCHAR(255) PRIMARY KEY,
    name NVARCHAR(255) NOT NULL,
    organization_id NVARCHAR(255) NOT NULL,
    manager_id NVARCHAR(255),
    description NVARCHAR(255),
    user_id NVARCHAR(255) NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    updated_at DATETIME2 NOT NULL DEFAULT GETDATE()
);

-- Projects (depends on organizations, departments, users)
CREATE TABLE projects (
    id NVARCHAR(255) PRIMARY KEY,
    name NVARCHAR(255) NOT NULL,
    description NVARCHAR(MAX),
    status NVARCHAR(50) NOT NULL DEFAULT 'active',
    organization_id NVARCHAR(255),
    department_id NVARCHAR(255),
    manager_id NVARCHAR(255),
    user_id NVARCHAR(255) NOT NULL,
    start_date DATE,
    end_date DATE,
    budget DECIMAL(10,2),
    project_number NVARCHAR(255),
    is_enterprise_wide BIT NOT NULL DEFAULT 0,
    is_template BIT NOT NULL DEFAULT 0,
    allow_time_tracking BIT NOT NULL DEFAULT 1,
    require_task_selection BIT NOT NULL DEFAULT 0,
    enable_budget_tracking BIT NOT NULL DEFAULT 0,
    enable_billing BIT NOT NULL DEFAULT 0,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    updated_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT CHK_projects_status CHECK (status IN ('active', 'inactive', 'completed', 'archived')),
    CONSTRAINT CHK_projects_dates CHECK (end_date IS NULL OR end_date >= start_date)
);

-- Tasks (depends on projects and users)
CREATE TABLE tasks (
    id NVARCHAR(255) PRIMARY KEY,
    project_id NVARCHAR(255) NOT NULL,
    title NVARCHAR(255) NOT NULL,
    name NVARCHAR(255),
    description NVARCHAR(MAX),
    status NVARCHAR(50) NOT NULL DEFAULT 'pending',
    priority NVARCHAR(50) NOT NULL DEFAULT 'medium',
    assigned_to NVARCHAR(255),
    created_by NVARCHAR(255),
    due_date DATE,
    estimated_hours DECIMAL(5,2),
    actual_hours DECIMAL(5,2) DEFAULT 0,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    updated_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT CHK_tasks_status CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    CONSTRAINT CHK_tasks_priority CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    CONSTRAINT CHK_tasks_hours CHECK (estimated_hours IS NULL OR estimated_hours >= 0)
);

-- Project-Employee assignments (depends on projects and employees)
CREATE TABLE project_employees (
    id NVARCHAR(255) PRIMARY KEY,
    project_id NVARCHAR(255) NOT NULL,
    employee_id NVARCHAR(255) NOT NULL,
    user_id NVARCHAR(255) NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT UQ_project_employee UNIQUE (project_id, employee_id)
);

-- Time Entries (depends on users, projects, tasks)
CREATE TABLE time_entries (
    id NVARCHAR(255) PRIMARY KEY,
    user_id NVARCHAR(255) NOT NULL,
    project_id NVARCHAR(255),
    task_id NVARCHAR(255),
    description NVARCHAR(MAX),
    hours DECIMAL(5,2) NOT NULL,
    duration DECIMAL(5,2) NOT NULL,
    date DATE NOT NULL,
    start_time DATETIME2,
    end_time DATETIME2,
    status NVARCHAR(50) NOT NULL DEFAULT 'draft',
    billable BIT NOT NULL DEFAULT 0,
    is_billable BIT NOT NULL DEFAULT 0,
    is_approved BIT NOT NULL DEFAULT 0,
    is_manual_entry BIT NOT NULL DEFAULT 1,
    is_timer_entry BIT NOT NULL DEFAULT 0,
    is_template BIT NOT NULL DEFAULT 0,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    updated_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT CHK_timeentry_hours CHECK (hours >= 0 AND hours <= 24),
    CONSTRAINT CHK_timeentry_duration CHECK (duration >= 0),
    CONSTRAINT CHK_timeentry_status CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
    CONSTRAINT CHK_timeentry_times CHECK (end_time IS NULL OR start_time IS NULL OR end_time >= start_time)
);
GO

-- =============================================================================
-- Add Foreign Key Constraints (NO ACTION to prevent cascade cycles)
-- =============================================================================

-- Organizations foreign keys
ALTER TABLE organizations 
ADD CONSTRAINT FK_organizations_user 
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Employees foreign keys  
ALTER TABLE employees 
ADD CONSTRAINT FK_employees_user 
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Departments foreign keys
ALTER TABLE departments 
ADD CONSTRAINT FK_departments_org 
FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE departments 
ADD CONSTRAINT FK_departments_manager 
FOREIGN KEY (manager_id) REFERENCES employees(id) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE departments 
ADD CONSTRAINT FK_departments_user 
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Projects foreign keys
ALTER TABLE projects 
ADD CONSTRAINT FK_projects_org 
FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE projects 
ADD CONSTRAINT FK_projects_dept 
FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE projects 
ADD CONSTRAINT FK_projects_manager 
FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE projects 
ADD CONSTRAINT FK_projects_user 
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Tasks foreign keys (CASCADE only for project deletion, NO ACTION for user references)
ALTER TABLE tasks 
ADD CONSTRAINT FK_tasks_project 
FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE tasks 
ADD CONSTRAINT FK_tasks_assigned 
FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE tasks 
ADD CONSTRAINT FK_tasks_creator 
FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Project employees foreign keys
ALTER TABLE project_employees 
ADD CONSTRAINT FK_projempl_project 
FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE project_employees 
ADD CONSTRAINT FK_projempl_employee 
FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE project_employees 
ADD CONSTRAINT FK_projempl_user 
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Time entries foreign keys (NO ACTION for all to prevent cycles)
ALTER TABLE time_entries 
ADD CONSTRAINT FK_timeentry_user 
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE time_entries 
ADD CONSTRAINT FK_timeentry_project 
FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE time_entries 
ADD CONSTRAINT FK_timeentry_task 
FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO

-- =============================================================================
-- Performance Indexes
-- =============================================================================

-- Users indexes
CREATE NONCLUSTERED INDEX IX_users_email ON users(email);
CREATE NONCLUSTERED INDEX IX_users_org ON users(organization_id) WHERE organization_id IS NOT NULL;
CREATE NONCLUSTERED INDEX IX_users_active ON users(is_active) WHERE is_active = 1;

-- Organizations indexes
CREATE NONCLUSTERED INDEX IX_organizations_user ON organizations(user_id);

-- Employees indexes
CREATE NONCLUSTERED INDEX IX_employees_user ON employees(user_id) WHERE user_id IS NOT NULL;
CREATE NONCLUSTERED INDEX IX_employees_dept ON employees(department);

-- Departments indexes
CREATE NONCLUSTERED INDEX IX_departments_org ON departments(organization_id);
CREATE NONCLUSTERED INDEX IX_departments_user ON departments(user_id);

-- Projects indexes
CREATE NONCLUSTERED INDEX IX_projects_user ON projects(user_id);
CREATE NONCLUSTERED INDEX IX_projects_org ON projects(organization_id) WHERE organization_id IS NOT NULL;
CREATE NONCLUSTERED INDEX IX_projects_status ON projects(status);
CREATE NONCLUSTERED INDEX IX_projects_dates ON projects(start_date, end_date);

-- Tasks indexes
CREATE NONCLUSTERED INDEX IX_tasks_project ON tasks(project_id);
CREATE NONCLUSTERED INDEX IX_tasks_assigned ON tasks(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE NONCLUSTERED INDEX IX_tasks_status ON tasks(status);
CREATE NONCLUSTERED INDEX IX_tasks_due ON tasks(due_date) WHERE due_date IS NOT NULL;

-- Project employees indexes
CREATE NONCLUSTERED INDEX IX_projempl_project ON project_employees(project_id);
CREATE NONCLUSTERED INDEX IX_projempl_employee ON project_employees(employee_id);

-- Time entries indexes
CREATE NONCLUSTERED INDEX IX_timeentry_user_date ON time_entries(user_id, date);
CREATE NONCLUSTERED INDEX IX_timeentry_project ON time_entries(project_id) WHERE project_id IS NOT NULL;
CREATE NONCLUSTERED INDEX IX_timeentry_task ON time_entries(task_id) WHERE task_id IS NOT NULL;
CREATE NONCLUSTERED INDEX IX_timeentry_status ON time_entries(status);
CREATE NONCLUSTERED INDEX IX_timeentry_billable ON time_entries(is_billable) WHERE is_billable = 1;
GO

-- =============================================================================
-- Update Triggers
-- =============================================================================

CREATE TRIGGER TR_users_update ON users AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    UPDATE users SET updated_at = GETDATE() WHERE id IN (SELECT id FROM inserted);
END;
GO

CREATE TRIGGER TR_organizations_update ON organizations AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    UPDATE organizations SET updated_at = GETDATE() WHERE id IN (SELECT id FROM inserted);
END;
GO

CREATE TRIGGER TR_employees_update ON employees AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    UPDATE employees SET updated_at = GETDATE() WHERE id IN (SELECT id FROM inserted);
END;
GO

CREATE TRIGGER TR_departments_update ON departments AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    UPDATE departments SET updated_at = GETDATE() WHERE id IN (SELECT id FROM inserted);
END;
GO

CREATE TRIGGER TR_projects_update ON projects AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    UPDATE projects SET updated_at = GETDATE() WHERE id IN (SELECT id FROM inserted);
END;
GO

CREATE TRIGGER TR_tasks_update ON tasks AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    UPDATE tasks SET updated_at = GETDATE() WHERE id IN (SELECT id FROM inserted);
END;
GO

CREATE TRIGGER TR_timeentries_update ON time_entries AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    UPDATE time_entries SET updated_at = GETDATE() WHERE id IN (SELECT id FROM inserted);
END;
GO

-- =============================================================================
-- Sample Data
-- =============================================================================

-- Test admin user
INSERT INTO users (id, email, first_name, last_name, role, is_active)
VALUES ('admin-001', 'admin@fmb.com', 'System', 'Administrator', 'admin', 1);

-- Default organization
INSERT INTO organizations (id, name, description, user_id) 
VALUES ('org-fmb', 'First Midwest Bank', 'Primary FMB organization', 'admin-001');

-- Update user with organization
UPDATE users SET organization_id = 'org-fmb' WHERE id = 'admin-001';

-- Test employee record
INSERT INTO employees (id, employee_id, first_name, last_name, department, user_id)
VALUES ('emp-admin', 'FMB001', 'System', 'Administrator', 'Information Technology', 'admin-001');

-- IT Department
INSERT INTO departments (id, name, description, organization_id, manager_id, user_id)
VALUES ('dept-it', 'Information Technology', 'IT Department', 'org-fmb', 'emp-admin', 'admin-001');

-- Sample project
INSERT INTO projects (id, name, description, status, organization_id, department_id, manager_id, user_id, allow_time_tracking)
VALUES ('proj-sample', 'TimeTracker Setup', 'Initial system setup and testing', 'active', 'org-fmb', 'dept-it', 'admin-001', 'admin-001', 1);
GO

-- =============================================================================
-- Validation
-- =============================================================================

PRINT '=== FMB TimeTracker Database Setup Complete ===';
PRINT '';

-- Table counts
SELECT 
    'users' as [Table], COUNT(*) as [Records] FROM users
UNION ALL SELECT 'organizations', COUNT(*) FROM organizations
UNION ALL SELECT 'employees', COUNT(*) FROM employees  
UNION ALL SELECT 'departments', COUNT(*) FROM departments
UNION ALL SELECT 'projects', COUNT(*) FROM projects
UNION ALL SELECT 'tasks', COUNT(*) FROM tasks
UNION ALL SELECT 'project_employees', COUNT(*) FROM project_employees
UNION ALL SELECT 'time_entries', COUNT(*) FROM time_entries;

PRINT '';
PRINT 'Database ready for TimeTracker application!';
PRINT 'Default admin user: admin@fmb.com (ID: admin-001)';
GO
