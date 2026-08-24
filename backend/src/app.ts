import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { logger } from './config/logger';
import { ENV } from './config/env';
import { initSentry, registerSentryErrorHandler } from './config/sentry';
import { SocketService } from './websocket/socket';
import { BackgroundJobs } from './jobs/cron';
import { errorHandler } from './core/middleware/error.middleware';
import { requestIdMiddleware } from './core/middleware/requestId.middleware';
import { generalRateLimiter } from './core/middleware/rateLimit.middleware';
import cookieParser from 'cookie-parser';

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
import merchantRouter from './modules/merchant/merchant.routes';
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
import { fileRouter } from './modules/file/file.routes';
import { publicRouter } from './modules/public/public.routes';

// ────────────────────────────────────────────────────────────────────────
// Modul ini HANYA merakit `app` Express + `httpServer` HTTP-nya — TIDAK
// pernah memanggil `.listen()`. Ini sengaja dipisah dari `server.ts` agar
// bisa di-`import` dengan aman oleh test (supertest) tanpa efek samping
// membuka port asli. `server.ts` adalah satu-satunya tempat yang boleh
// memanggil `.listen()`.
// ────────────────────────────────────────────────────────────────────────

export const app = express();
// Backend berada di belakang reverse proxy (Nginx / Cloudflare).
// Percayai satu hop proxy terdekat agar req.ip dan express-rate-limit
// dapat membaca X-Forwarded-For dengan benar.
if (ENV.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

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
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(
  cors({
    // 🆕 FIX AUTH CONTRACT / REFRESH COOKIE INTEGRATION: sebelumnya jatuh
    // ke '*' kalau ALLOWED_ORIGINS kosong/lupa di-set. Kombinasi
    // `origin: '*'` + `credentials: true` SECARA SPESIFIKASI CORS TIDAK
    // VALID -- browser MENOLAK melampirkan/menerima cookie (termasuk
    // httpOnly refreshToken cookie) kalau Access-Control-Allow-Origin
    // adalah wildcard sementara request dikirim dengan credentials.
    // Efeknya: kalau env ALLOWED_ORIGINS lupa di-set saat deploy,
    // SELURUH mekanisme refresh-token-via-cookie diam-diam MATI TOTAL di
    // production (bukan error yang jelas -- request gagal CORS di
    // browser tanpa pesan yang jelas ke user). Sekarang: gagal cepat &
    // jelas di startup kalau production tapi ALLOWED_ORIGINS kosong,
    // supaya ketauan pas deploy, bukan pas user nge-refresh browser lalu
    // ke-logout misterius.
    origin: (() => {
      if (ENV.ALLOWED_ORIGINS.length > 0) return ENV.ALLOWED_ORIGINS;
      if (ENV.NODE_ENV === 'production') {
        throw new Error(
          '[CORS] ALLOWED_ORIGINS wajib diisi di production! origin:"*" + credentials:true tidak valid secara spesifikasi CORS dan akan mematikan refresh-token cookie secara diam-diam.'
        );
      }
      // Dev/test: fallback ke true (reflect request origin) -- BUKAN
      // literal '*', supaya credentials:true tetap valid untuk browser
      // saat development lokal tanpa perlu set env dulu.
      return true;
    })(),
    credentials: true,
  })
);
app.use(express.json());
app.use(MetricsService.middleware());
app.use(cookieParser());

// 🆕 FIX P0 "correlation/request ID dan logging terstruktur" (audit
// driver-jobs): dipasang sedini mungkin (setelah body/cookie parser,
// sebelum route apa pun) supaya SEMUA request -- termasuk yang gagal di
// middleware auth/rate-limit sebelum sempat masuk ke route handler --
// tetap punya requestId yang konsisten untuk dilacak di log.
app.use(requestIdMiddleware);

// 3. Initialize Realtime WebSockets (Socket.IO) — di-skip saat test agar
//    tidak membuka handle yang membuat proses Jest menggantung.
if (process.env.NODE_ENV !== 'test') {
  SocketService.init(httpServer);
  BackgroundJobs.init();
}

// Telemetry, Health, and Documentation routes
app.get('/health', HealthCheckController.check as any);
app.get('/metrics', MetricsService.getMetrics.bind(MetricsService));
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
app.use('/api/dispatch', dispatchRouter);
app.use('/api/files', fileRouter);
app.use('/api/public', publicRouter);

// ============================================================
// 🔒 API 404 HANDLER - UNKNOWN API ROUTE (JSON)
// HARUS SEBELUM SPA FALLBACK
// ============================================================
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: `API route not found: ${req.method} ${req.originalUrl}`,
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString(),
  });
});

// Media hasil /api/upload/image dikembalikan sebagai URL backend /uploads/... .
// WAJIB disajikan di backend agar preview dari Vite (localhost:5173) tidak
// jatuh ke SPA fallback dan berubah menjadi halaman dashboard/landing page.
// Catatan: ini mempertahankan kontrak upload legacy V4.7.x. Endpoint /api/files
// tetap menjadi jalur protected untuk file yang sudah tercatat di tabel File.
app.use(UPLOADS_PUBLIC_PATH, express.static(UPLOAD_DIR_ABSOLUTE, {
  fallthrough: true,
  index: false,
  maxAge: 0,
}));

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

// ============================================================
// 🔓 SPA FALLBACK - HANYA UNTUK NON-API ROUTES
// HARUS SETELAH API 404 HANDLER
// ============================================================
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