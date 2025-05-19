FROM node:18-alpine

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++ bash curl

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Expose the port Railway uses
ENV PORT=3000
EXPOSE 3000

# Start the application
CMD ["node", "index.js"] 