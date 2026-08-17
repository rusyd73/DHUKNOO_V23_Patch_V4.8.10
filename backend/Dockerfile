# syntax=docker/dockerfile:1

# ---- Stage 1: deps + build ----
FROM node:20-slim AS builder
WORKDIR /app

# openssl dibutuhkan oleh Prisma query engine (debian-based image, bukan alpine,
# supaya tidak perlu menambah binaryTargets musl di schema.prisma)
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# ---- Stage 2: production runtime ----
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

EXPOSE 3000

# Terapkan migration lalu jalankan server. Railway menyediakan $PORT saat runtime;
# server.ts harus membaca process.env.PORT (fallback 3000 untuk lokal/docker-compose).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
