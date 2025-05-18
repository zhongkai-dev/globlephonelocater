#!/bin/bash
# This script installs dependencies before the container starts

# Ensure connect-flash is installed
echo "Installing required dependencies..."
npm install connect-flash --save

echo "Build script completed successfully"
exit 0 