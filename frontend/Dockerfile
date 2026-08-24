# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend ./frontend
COPY packages ./packages
RUN npm ci
ARG VITE_API_URL=""
ARG VITE_API_BASE_URL=""
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build --workspace=frontend

FROM nginx:1.27-alpine AS runner
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
