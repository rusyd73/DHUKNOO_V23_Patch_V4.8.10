# syntax=docker/dockerfile:1

# ---- Stage 1: build ----
FROM node:20-slim AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# VITE_API_URL / VITE_API_BASE_URL wajib di-inject saat BUILD TIME (Vite membakar
# env ke dalam bundle statis), bukan saat runtime. Isi via --build-arg di CI,
# atau via "Build Variables" di Railway (bukan hanya "Variables" biasa).
ARG VITE_API_URL
ARG VITE_API_BASE_URL
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build

# ---- Stage 2: serve static files ----
FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
