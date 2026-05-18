# FundTrader v2 Frontend Dockerfile
FROM node:22-alpine AS builder

WORKDIR /app
COPY v2/frontend/package.json v2/frontend/package-lock.json ./
RUN npm ci

COPY v2/frontend/ ./
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY v2/frontend/fundtrader-v2.service ./

ENV NODE_ENV=production
ENV PORT=3000
ENV FUNDTRADER_API_BASE=http://127.0.0.1:8766

EXPOSE 3000

CMD ["node", "dist/boot.js"]
