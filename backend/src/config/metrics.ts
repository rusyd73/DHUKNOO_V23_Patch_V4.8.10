import client from 'prom-client';
import express, { Request, Response, NextFunction } from 'express';
import { logger } from './logger';
import { ENV } from './env';

// ============================================================
// 🔒 METRICS - DENGAN AUTH TOKEN
// ============================================================

// 🔥 Metrics token untuk akses /metrics (set di env)
const METRICS_TOKEN = process.env.METRICS_TOKEN || '';

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
   * 🔒 Controller to output standard Prometheus scrapable metrics text
   * DENGAN AUTHENTICATION
   */
  public static async getMetrics(req: Request, res: Response) {
    // ============================================================
    // 🔒 AUTHENTIKASI - TOKEN ATAU IP INTERNAL
    // ============================================================
    const authHeader = req.headers.authorization;
    const clientIp = req.ip || req.connection.remoteAddress || '';

    // 🔥 Cek token
    const hasValidToken = METRICS_TOKEN && authHeader === `Bearer ${METRICS_TOKEN}`;

    // 🔥 Cek apakah dari internal network
    const isInternal = 
      clientIp.includes('127.0.0.1') || 
      clientIp.includes('::1') || 
      clientIp.includes('192.168.') || 
      clientIp.includes('10.') ||
      clientIp.includes('172.16.') ||
      clientIp.includes('172.17.') ||
      clientIp.includes('172.18.') ||
      clientIp.includes('172.19.') ||
      clientIp.includes('172.20.') ||
      clientIp.includes('172.21.') ||
      clientIp.includes('172.22.') ||
      clientIp.includes('172.23.') ||
      clientIp.includes('172.24.') ||
      clientIp.includes('172.25.') ||
      clientIp.includes('172.26.') ||
      clientIp.includes('172.27.') ||
      clientIp.includes('172.28.') ||
      clientIp.includes('172.29.') ||
      clientIp.includes('172.30.') ||
      clientIp.includes('172.31.');

    // 🔒 Tolak akses jika tidak valid
    if (!hasValidToken && !isInternal) {
      logger.warn(`[Metrics] Unauthorized access attempt from ${clientIp}`);
      return res.status(401).json({ 
        error: 'Unauthorized. Set METRICS_TOKEN in .env or access from internal network.' 
      });
    }

    // 🔓 Kirim metrics
    try {
      res.setHeader('Content-Type', MetricsService.registry.contentType);
      const content = await MetricsService.registry.metrics();
      res.send(content);
    } catch (err: any) {
      logger.error('[Metrics] Failed to generate metrics:', err);
      return res.status(500).json({ error: 'Failed to generate metrics' });
    }
  }
}