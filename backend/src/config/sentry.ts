import * as Sentry from '@sentry/node';
import express from 'express';
import { logger } from './logger';
import { ENV } from './env';

// ============================================================
// 🔒 SENTRY SAMPLING RATES
// ============================================================

const isProduction = ENV.NODE_ENV === 'production';

// 🔥 PRODUCTION: sampling rendah untuk hemat kuota & performa
// DEVELOPMENT: sampling tinggi untuk debugging
const TRACES_SAMPLE_RATE = isProduction 
  ? parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1') 
  : 1.0;

const PROFILES_SAMPLE_RATE = isProduction 
  ? parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE || '0.05') 
  : 1.0;

// 🔥 HANYA kirim error (bisa diaktifkan via env)
const SEND_ERRORS_ONLY = process.env.SENTRY_ERRORS_ONLY === 'true';

export const initSentry = (app: express.Application) => {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.warn('SENTRY_DSN is not configured. Sentry tracking is disabled.');
    return;
  }

  logger.info(`[Sentry] Initializing with trace sample rate: ${TRACES_SAMPLE_RATE}, profile sample rate: ${PROFILES_SAMPLE_RATE}`);

  // PENTING: `@sentry/profiling-node` di-import secara DINAMIS di sini (bukan
  // `import` statis di paling atas file) karena paket ini butuh file native
  // (.node) khusus per OS/arch. Kalau di-import statis, Node akan mencoba
  // memuat file native itu SETIAP kali server dijalankan — bahkan saat
  // SENTRY_DSN kosong/Sentry dimatikan — dan bisa bikin server crash total
  // kalau file native-nya gagal terpasang (mis. karena npm install script
  // di-skip). Dengan import dinamis di dalam blok ini, paket itu HANYA
  // disentuh kalau Sentry benar-benar mau dipakai (dsn terisi).
  let profilingIntegration: any[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ProfilingIntegration } = require('@sentry/profiling-node');
    profilingIntegration = [new ProfilingIntegration()];
  } catch (err: any) {
    logger.warn(
      `Sentry profiling native module gagal dimuat (dilewati, tidak fatal): ${err.message}`
    );
  }

  Sentry.init({
    dsn,
    integrations: [
      // enable HTTP calls tracing
      new Sentry.Integrations.Http({ tracing: true }),
      // enable Express.js middleware tracing
      new Sentry.Integrations.Express({ app }),
      ...profilingIntegration,
    ],
    // 🔥 Performance Monitoring - sampling disesuaikan
    tracesSampleRate: TRACES_SAMPLE_RATE,
    // 🔥 Profiling - sampling disesuaikan
    profilesSampleRate: PROFILES_SAMPLE_RATE,
    // 🔥 Hanya kirim error jika diaktifkan
    enabled: !SEND_ERRORS_ONLY,
    // 🔥 FILTER: jangan kirim health check ke Sentry
    beforeSend(event, hint) {
      if (hint?.originalException) {
        const err = hint.originalException as any;
        if (err.message?.includes('health') || err.message?.includes('metrics')) {
          return null;
        }
      }
      return event;
    },
  });

  // The request handler must be the first middleware on the app
  app.use(Sentry.Handlers.requestHandler());
  // TracingHandler creates a transaction for every incoming request
  app.use(Sentry.Handlers.tracingHandler());
  
  logger.info(`[Sentry] Initialized with sampling rates: traces=${TRACES_SAMPLE_RATE}, profiles=${PROFILES_SAMPLE_RATE}`);
};

export const registerSentryErrorHandler = (app: express.Application) => {
  if (process.env.SENTRY_DSN) {
    // The error handler must be before any other error middleware and after all controllers
    app.use(Sentry.Handlers.errorHandler());
    logger.info('Sentry Error Handler Middleware registered.');
  }
};

// ============================================================
// 🔒 HELPER: Cek apakah Sentry aktif
// ============================================================
export const isSentryEnabled = (): boolean => {
  return !!process.env.SENTRY_DSN;
};

// ============================================================
// 🔒 HELPER: Ambil sampling rate saat ini
// ============================================================
export const getSentryConfig = () => ({
  tracesSampleRate: TRACES_SAMPLE_RATE,
  profilesSampleRate: PROFILES_SAMPLE_RATE,
  environment: ENV.NODE_ENV,
  sendErrorsOnly: SEND_ERRORS_ONLY,
});