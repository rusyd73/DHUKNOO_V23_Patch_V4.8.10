import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { logger } from './config/logger';
import { ENV } from './config/env';
import { initSentry, registerSentryErrorHandler } from './config/sentry';
import { SocketService } from './websocket/socket';
import { BackgroundJobs } from './jobs/cron';
import { errorHandler } from './core/middleware/error.middleware';
import { generalRateLimiter } from './core/middleware/rateLimit.middleware';

// Import services and controllers for telemetry & documentation
import { RedisService } from './config/redis';
import { QueueService } from './jobs/bullmq';
import { MetricsService } from './config/metrics';
import { MailerService } from './config/mailer';
import { HealthCheckController } from './config/health';
import { SwaggerSpecification } from './docs/swagger-spec';

// Import domain module routes
import { authRouter } from './modules/auth/auth.routes';
import { adminRouter } from './modules/admin/admin.routes';
import { reportRoutes } from './modules/report/report.routes';
import { driverRouter } from './modules/driver/driver.routes';
import { customerRouter } from './modules/customer/customer.routes';
import { merchantRouter } from './modules/merchant/merchant.routes';
import { orderRouter } from './modules/order/order.routes';
import { paymentRouter } from './modules/payment/payment.routes';
import { walletRouter } from './modules/wallet/wallet.routes';
import { notificationRouter } from './modules/notification/notification.routes';
import { locationRouter } from './modules/location/location.routes';
import { promoRouter } from './modules/promo/promo.routes';
import { reviewRouter } from './modules/review/review.routes';
import { tariffRouter } from './modules/tariff/tariff.routes';
import { uploadRouter } from './modules/upload/upload.routes';
import dispatchRouter from './modules/dispatch/dispatch.route';
import { UPLOAD_DIR_ABSOLUTE, UPLOADS_PUBLIC_PATH } from './modules/upload/upload.config';

// ────────────────────────────────────────────────────────────────────────
// Modul ini HANYA merakit `app` Express + `httpServer` HTTP-nya — TIDAK
// pernah memanggil `.listen()`. Ini sengaja dipisah dari `server.ts` agar
// bisa di-`import` dengan aman oleh test (supertest) tanpa efek samping
// membuka port asli. `server.ts` adalah satu-satunya tempat yang boleh
// memanggil `.listen()`.
// ────────────────────────────────────────────────────────────────────────

export const app = express();
export const httpServer = createServer(app);

// 1. Initialize Sentry (must be first)
initSentry(app);

// Initialize Configured Services (Redis, metrics, queue). Dibiarkan best-effort:
// kegagalan di sini di-log tapi tidak menjatuhkan proses/test — endpoint yang
// tidak butuh Redis/queue tetap bisa diuji.
export const startServices = async () => {
  await RedisService.init();
  MetricsService.init();
  QueueService.init();
  MailerService.init();
};

if (process.env.NODE_ENV !== 'test') {
  startServices().catch((err) => {
    logger.error('Error starting core backend services: %s', (err as Error).message || err);
  });
}

// 2. Register Global Middlewares
// CORS dibatasi ke ALLOWED_ORIGINS (env, comma-separated). Kalau belum diset,
// fallback ke "*" supaya development tetap mudah — TAPI wajib diisi di production.
app.use(
  cors({
    origin: ENV.ALLOWED_ORIGINS.length > 0 ? ENV.ALLOWED_ORIGINS : '*',
    credentials: true,
  })
);
app.use(express.json());
app.use(MetricsService.middleware());

// 3. Initialize Realtime WebSockets (Socket.IO) — di-skip saat test agar
//    tidak membuka handle yang membuat proses Jest menggantung.
if (process.env.NODE_ENV !== 'test') {
  SocketService.init(httpServer);
  BackgroundJobs.init();
}

// Telemetry, Health, and Documentation routes
app.get('/health', HealthCheckController.check as any);
app.get('/metrics', MetricsService.getMetrics as any);
app.use('/docs', swaggerUi.serve, swaggerUi.setup(SwaggerSpecification));

// 5. Register Domain Routes
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to DHUKNOO Ride (Ojek Batu - Malang) Backend API Service' });
});

app.use('/api/auth', authRouter);
app.use('/api', generalRateLimiter);
app.use('/api/admin', adminRouter);
app.use('/api/driver', driverRouter);
app.use('/api/customer', customerRouter);
app.use('/api/merchant', merchantRouter);
app.use('/api/order', orderRouter);
app.use('/api/payment', paymentRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/notification', notificationRouter);
app.use('/api/location', locationRouter);
app.use('/api/promo', promoRouter);
app.use('/api/review', reviewRouter);
app.use('/api/tariff', tariffRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/report', reportRoutes);
// Dispatch Engine (mesin penawaran driver terdekat) — dilindungi auth di dalam
// dispatch.route.ts sendiri (lihat catatan keamanan di file tsb).
app.use('/api/dispatch', dispatchRouter);

// Foto KTP/STNK & bukti bayar disajikan statis dari sini (mis. /uploads/xxxx.jpg)
app.use(UPLOADS_PUBLIC_PATH, express.static(UPLOAD_DIR_ABSOLUTE));

// Serve Vite frontend in development, or static build in production
import fs from 'fs';
import path from 'path';

const distPath = path.resolve(__dirname, '../../frontend/dist');
const useViteDev = process.env.NODE_ENV !== "production" && process.env.VITE_DEV_SERVER === "true";

let viteInstance: any = null;
const vitePromise = (async () => {
  if (useViteDev) {
    try {
      const { createServer: createViteServer } = await import('vite');
      viteInstance = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
        root: path.resolve(__dirname, '../../frontend'),
      });
      logger.info('Vite development middleware initialized successfully.');
    } catch (err: any) {
      logger.error('Failed to initialize Vite development server: %s', err.message || err);
    }
  }
})();

app.use(async (req: any, res: any, next: any) => {
  if (useViteDev) {
    await vitePromise;
    if (viteInstance) {
      viteInstance.middlewares(req, res, next);
    } else {
      next();
    }
  } else {
    next();
  }
});

// Serve static build if we are not using Vite dev server (extremely light on RAM/CPU)
if (!useViteDev) {
  if (fs.existsSync(distPath)) {
    logger.info('Serving pre-built static frontend from: %s (Lightweight Mode)', distPath);
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  } else {
    logger.warn('Pre-built frontend not found at %s. Falling back to dynamic routing...', distPath);
  }
}

// 6. Register Sentry Error Handlers (must be after routers, before custom handlers)
registerSentryErrorHandler(app);

// 7. Core Centralized Error Handling Middleware
app.use(errorHandler as any);
