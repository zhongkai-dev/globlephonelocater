FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Bundle app source
COPY . .

# Create database directory
RUN mkdir -p database

# Expose the port the app runs on
EXPOSE 3000

# Start the application
CMD ["npm", "start"] 