import { Response } from 'express';
import { AuthenticatedRequest } from '../../core/middleware/auth.middleware';
import { PromoService } from './promo.service';
import { AppError } from '../../core/errors/AppError';
import { logger } from '../../config/logger';

export class PromoController {
  private promoService = new PromoService();

  list = async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const promos = await this.promoService.listActivePromos();
      return res.status(200).json({ promos });
    } catch (err: any) {
      logger.error('PromoController.list error: %s', err.message);
      return res.status(500).json({ error: 'Gagal mengambil daftar promo.' });
    }
  };

  validate = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { code, orderPrice } = req.body;
      const result = await this.promoService.validateAndPreview(code, orderPrice);
      return res.status(200).json({
        message: 'Kode promo valid!',
        discount: result.discount,
        finalPrice: result.finalPrice,
        promo: result.promo,
      });
    } catch (err: any) {
      logger.error('PromoController.validate error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal memvalidasi kode promo.' });
    }
  };

  create = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const promo = await this.promoService.createPromo(req.body);
      return res.status(201).json({ message: 'Promo berhasil dibuat!', promo });
    } catch (err: any) {
      logger.error('PromoController.create error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal membuat promo.' });
    }
  };
}
