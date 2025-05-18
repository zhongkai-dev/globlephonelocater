FROM node:18-alpine

WORKDIR /app

# Install build dependencies (needed for some npm packages)
RUN apk add --no-cache python3 make g++ bash curl

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies with clear cache to keep image size smaller
RUN npm config set registry https://registry.npmjs.org/ && \
    npm cache clean --force && \
    npm install --no-optional && \
    npm cache clean --force

# Explicitly install connect-flash to ensure it's available
RUN npm install connect-flash --save

# Copy application code
COPY . .

# Make entrypoint executable
RUN chmod +x entrypoint.sh

# Create volume for persistent data
VOLUME [ "/app/data" ]

# Health check to ensure the app is running properly
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/ || exit 1

# Expose the port
EXPOSE ${PORT:-3000}

# Use entrypoint script to handle startup
ENTRYPOINT ["./entrypoint.sh"] 