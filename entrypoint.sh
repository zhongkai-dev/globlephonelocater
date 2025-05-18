#!/bin/bash
set -e

# Print environment info (excluding sensitive values)
echo "======================================"
echo "Starting Phone Locator Bot Application"
echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"
echo "======================================"

# Make sure connect-flash is installed
if ! npm list connect-flash > /dev/null; then
  echo "Installing connect-flash..."
  npm install connect-flash --save
fi

# Check for critical environment variables
if [ -z "$MONGODB_URI" ]; then
  echo "⚠️ Warning: MONGODB_URI is not set. Database connectivity may fail."
fi

if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
  echo "⚠️ Warning: TELEGRAM_BOT_TOKEN is not set. Bot functionality will be disabled."
fi

# Start the application
echo "Starting application..."
exec node index.js 