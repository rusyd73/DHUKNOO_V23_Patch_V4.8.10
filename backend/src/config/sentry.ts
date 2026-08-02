import * as Sentry from '@sentry/node';
import express from 'express';
import { logger } from './logger';

export const initSentry = (app: express.Application) => {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.warn('SENTRY_DSN is not configured. Sentry tracking is disabled.');
    return;
  }

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
    // Performance Monitoring
    tracesSampleRate: 1.0, //  Capture 100% of the transactions for performance monitoring.
    // Set sampling rate for profiling - this is relative to tracesSampleRate
    profilesSampleRate: 1.0,
  });

  // The request handler must be the first middleware on the app
  app.use(Sentry.Handlers.requestHandler());
  // TracingHandler creates a transaction for every incoming request
  app.use(Sentry.Handlers.tracingHandler());
  
  logger.info('Sentry Error & Performance Tracking Initialized successfully.');
};

export const registerSentryErrorHandler = (app: express.Application) => {
  if (process.env.SENTRY_DSN) {
    // The error handler must be before any other error middleware and after all controllers
    app.use(Sentry.Handlers.errorHandler());
    logger.info('Sentry Error Handler Middleware registered.');
  }
};
