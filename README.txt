# Dukan Alhujoor - Production Package

## Included Files:

### 1. Server:
- server-production-fixed.js - Production optimized server file

### 2. Project Configuration:
- package-production.json - npm settings for production
- .env.production - Environment variables for production

### 3. Database:
- production_database_setup.sql - Database setup script

### 4. Static Files:
- public/ - CSS files and images
- views/ - EJS templates
- uploads/ - File upload directory

## Installation Steps:

### 1. Upload Files:
1. Upload all files to your website directory on the server
2. Make sure to preserve the directory structure

### 2. Database Setup:
1. Open phpMyAdmin or MySQL
2. Execute the production_database_setup.sql file
3. Verify all tables are created successfully

### 3. File Configuration:
1. Rename .env.production to .env
2. Rename package-production.json to package.json
3. Rename server-production-fixed.js to server.js

### 4. Update Settings:
1. Open the .env file
2. Update database information:
   - DB_HOST=localhost
   - DB_USER=[your_username]
   - DB_PASSWORD=[your_password]
   - DB_NAME=dukaazbg_dukan_alhujoor

### 5. Run Application:
1. From cPanel, go to Node.js
2. Select Node.js version 16.x
3. Set startup file to server.js
4. Restart the application

## Admin Login Credentials:
- Username: admin
- Password: Admin@123456

## Technical Support:
If you encounter issues, check:
1. Database settings in .env file
2. File and directory permissions
3. Node.js version (prefer 16.x)
4. Error logs in cPanel

---
Package created on: 2025-09-07-1230
