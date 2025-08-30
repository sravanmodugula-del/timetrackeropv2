# FMB TimeTracker On-Premises Setup

This directory contains all the necessary files and configurations for deploying TimeTracker on FMB's on-premises infrastructure.

## Architecture Overview

- **Application Server**: HUB-DEVAPP01-C3 (Windows Server with IIS reverse proxy)
- **Database**: HUB-SQL1TST-LIS (MS SQL Server)
- **Authentication**: RSA SAML Identity Provider
- **Domain**: https://timetracker.fmb.com
- **Port**: 3000 (proxied through IIS to 443)

## Installation Steps

### 1. Prerequisites
- Windows Server 2022
- Node.js 20.x or higher
- MS SQL Server access
- IIS with URL Rewrite Module
- PowerShell 5.1 or higher

### 2. Database Setup
```powershell
# Run the database setup script on HUB-SQL1TST-LIS
sqlcmd -S HUB-SQL1TST-LIS -d timetracker -U timetracker -P "iTT!\$Lo7gm\"i\'JAg~5Y\\" -i fmb-setup-db.sql
```

### 3. Application Installation
```powershell
# Run the installation script as Administrator
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
.\scripts\fmb-install.ps1
```

### 4. Configuration
Edit `C:\fmb-timetracker\.env` with your environment-specific values:
- Update database connection details
- Configure SAML certificate and endpoints
- Set session secrets and security settings

### 5. IIS Reverse Proxy Configuration
```powershell
# Configure IIS reverse proxy as Administrator
.\scripts\fmb-iis-config.ps1
```

### 6. Start the Application
```powershell
# Navigate to application directory
cd C:\fmb-timetracker

# Start with PM2
npx pm2 start ecosystem.config.js

# Or start Windows service (if installed)
net start FMBTimeTracker
```

## Maintenance

### Viewing Logs
```powershell
# PM2 logs
npx pm2 logs

# Log files location
Get-Content C:\fmb-timetracker\logs\combined.log -Tail 50 -Wait
```

### Deployment Updates
```powershell
# Run as Administrator
.\scripts\fmb-deploy.ps1
```

### Service Management
```powershell
# PM2 Status
npx pm2 status

# Restart application
npx pm2 restart ecosystem.config.js

# Windows Service (if using service mode)
net start FMBTimeTracker
net stop FMBTimeTracker
net restart FMBTimeTracker

# IIS Management
iisreset /restart
```

## Synchronization Strategy

The application is designed to maintain feature parity between Replit and on-premises versions:

1. **Core Business Logic**: Shared in `/shared` and `/server` directories
2. **Environment Detection**: Automatic detection via `FMB_DEPLOYMENT=onprem`
3. **Database Abstraction**: Same schema, different drivers (PostgreSQL vs MS SQL)
4. **Authentication Abstraction**: Pluggable auth strategies (Replit OAuth vs SAML)

## Troubleshooting

### Common Issues

1. **Database Connection Failures**
   - Verify MS SQL Server is accessible
   - Check firewall settings
   - Validate credentials

2. **SAML Authentication Issues**
   - Verify certificate format
   - Check IDP metadata configuration
   - Validate ACS URL accessibility

3. **IIS Proxy Issues**
   - Ensure URL rewrite module is installed
   - Verify proxy rules configuration
   - Check application pool settings

### Health Checks

The application provides health check endpoints:
- `/api/health` - General application health
- `/api/health/database` - Database connectivity
- `/api/health/saml` - SAML configuration validation

## Security Considerations

1. **TLS/SSL**: Ensure all traffic is encrypted
2. **Session Management**: Use secure session storage
3. **SAML Security**: Validate all SAML assertions
4. **Database Security**: Use encrypted connections
5. **Logging**: Ensure sensitive data is not logged

## Contact

For support with the on-premises deployment, contact the FMB IT team.