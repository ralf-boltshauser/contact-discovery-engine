# Use Node.js v20 as base image
FROM node:20-slim

# Install pnpm
RUN npm install -g pnpm

# Install required dependencies for Playwright
RUN apt-get update && apt-get install -y \
  libglib2.0-0 \
  libnss3 \
  libnspr4 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libdrm2 \
  libdbus-1-3 \
  libxcb1 \
  libxkbcommon0 \
  libx11-6 \
  libxcomposite1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxrandr2 \
  libgbm1 \
  libpango-1.0-0 \
  libcairo2 \
  libasound2 \
  && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Install Playwright browsers
RUN pnpm exec playwright install chromium --with-deps

# Copy source code
COPY . .

# Build TypeScript code
RUN pnpm build

# Expose port 3000
EXPOSE 3000

# Start the application in web mode
CMD ["sh", "-c", "NODE_NO_WARNINGS=1 node --loader ts-node/esm --experimental-specifier-resolution=node src/index.ts --web"] 