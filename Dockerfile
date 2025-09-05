# Use official Node.js image
FROM node:18

# Set working directory
WORKDIR /app

# Copy package.json + lock files first
COPY package*.json tsconfig.json ./

# Install dependencies
RUN npm install

# Copy all source code
COPY . .

# Build TypeScript -> dist/
RUN npm run build

# Expose backend port
EXPOSE 3001

# Start the compiled server
CMD ["npm", "start"]
