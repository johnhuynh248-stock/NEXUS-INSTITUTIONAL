# Use Node 18 (Railway compatible)
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files first (important for caching)
COPY package.json package-lock.json ./

# Install ONLY production dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Start the bot
CMD ["node", "src/index.js"]
