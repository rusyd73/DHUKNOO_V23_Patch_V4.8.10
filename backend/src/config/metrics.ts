import client from 'prom-client';
import express, { Request, Response, NextFunction } from 'express';
import { logger } from './logger';

export class MetricsService {
  private static registry = new client.Registry();
  private static isInitialized = false;

  private static httpRequestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests processed',
    labelNames: ['method', 'route', 'status_code'],
  });

  private static httpRequestDurationSeconds = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.1, 0.3, 0.5, 1, 2, 5],
  });

  public static init() {
    // Idempotency guard: prom-client MELEMPAR ERROR kalau metric dengan nama
    // yang sama didaftarkan dua kali ke registry yang sama. init() bisa saja
    // terpanggil lebih dari sekali dalam proses yang sama (mis. hot-reload
    // dev server, atau kode caller yang keliru memanggilnya berulang) — guard
    // ini memastikan panggilan kedua dst. cukup di-skip dengan aman, bukan
    // menjatuhkan seluruh proses startup backend.
    if (this.isInitialized) {
      logger.warn('MetricsService.init() dipanggil lebih dari sekali — panggilan berikutnya diabaikan (aman).');
      return;
    }

    logger.info('Initializing Prometheus metrics engine...');

    // Register default system metrics (CPU, Memory, event loop lag, etc.)
    client.collectDefaultMetrics({ register: this.registry });

    // Register custom metrics
    this.registry.registerMetric(this.httpRequestsTotal);
    this.registry.registerMetric(this.httpRequestDurationSeconds);

    this.isInitialized = true;
    logger.info('Prometheus metrics initialized.');
  }

  /**
   * Express middleware to capture duration and response code metrics
   */
  public static middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const start = process.hrtime();
      
      res.on('finish', () => {
        const diff = process.hrtime(start);
        const duration = diff[0] + diff[1] / 1e9;
        
        const route = req.route ? req.route.path : req.path;
        const labels = {
          method: req.method,
          route: route || 'unknown_route',
          status_code: res.statusCode.toString(),
        };
        
        this.httpRequestsTotal.inc(labels);
        this.httpRequestDurationSeconds.observe(labels, duration);
      });
      
      next();
    };
  }

  /**
   * Controller to output standard Prometheus scrapable metrics text
   */
  public static async getMetrics(req: Request, res: Response) {
    res.setHeader('Content-Type', MetricsService.registry.contentType);
    const content = await MetricsService.registry.metrics();
    res.send(content);
  }
}
