FROM node:22-alpine AS builder

WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY frontend/fundtrader-frontend.service ./

ENV NODE_ENV=production
ENV PORT=3000
ENV FUNDTRADER_API_BASE=http://127.0.0.1:8766

EXPOSE 3000

CMD ["node", "dist/boot.js"]
