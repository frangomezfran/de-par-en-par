# Stage 1: Build client
FROM node:22-alpine AS client-builder
WORKDIR /app/client

COPY client/package*.json ./
RUN npm ci || npm install

COPY client/ ./
RUN npm run build

# Stage 2: Runtime server
FROM node:22-alpine
WORKDIR /app

# Install server production dependencies
COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm ci --omit=dev || npm install --omit=dev

# Copy server code
COPY server/ ./

# Copy built client from stage 1
COPY --from=client-builder /app/client/dist /app/client/dist

# Set up data directory and permissions
WORKDIR /app
RUN mkdir -p /app/data && chown -R node:node /app

USER node

ENV NODE_ENV=production \
    PORT=3001 \
    DATA_DIR=/app/data \
    CLIENT_DIST=/app/client/dist

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --spider -q http://localhost:3001/api/health || exit 1

WORKDIR /app/server
CMD ["node", "src/index.js"]
