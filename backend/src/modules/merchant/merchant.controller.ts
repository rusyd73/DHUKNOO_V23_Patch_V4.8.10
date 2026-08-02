import { Response } from 'express';
import { AuthenticatedRequest } from '../../core/middleware/auth.middleware';
import { MerchantService } from './merchant.service';
import { AppError } from '../../core/errors/AppError';
import { logger } from '../../config/logger';
import { AuditLogger } from '../../core/logging/audit.logger';

export class MerchantController {
  private merchantService = new MerchantService();

  list = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const category = req.query.category as string | undefined;
      const isOpen = req.query.isOpen !== undefined ? req.query.isOpen === 'true' : undefined;
      const merchants = await this.merchantService.list({ category, isOpen });
      return res.status(200).json({ merchants });
    } catch (err: any) {
      logger.error('MerchantController.list error: %s', err.message);
      return res.status(500).json({ error: 'Gagal mengambil daftar merchant.' });
    }
  };

  getDetail = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const merchant = await this.merchantService.getDetail(id);
      return res.status(200).json({ merchant });
    } catch (err: any) {
      logger.error('MerchantController.getDetail error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal mengambil detail merchant.' });
    }
  };

  getMine = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const merchant = await this.merchantService.getMine(req.user!.id);
      return res.status(200).json({ merchant });
    } catch (err: any) {
      logger.error('MerchantController.getMine error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal mengambil data toko Anda.' });
    }
  };

  create = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const merchant = await this.merchantService.create(req.body);
      await AuditLogger.log(req.user!.id, 'MERCHANT_CREATE', `Membuat merchant baru: ${merchant.name}`);
      return res.status(201).json({ message: 'Merchant berhasil dibuat!', merchant });
    } catch (err: any) {
      logger.error('MerchantController.create error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal membuat merchant.' });
    }
  };

  update = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const merchant = await this.merchantService.update(id, req.user!.id, req.user!.role, req.body);
      await AuditLogger.log(req.user!.id, 'MERCHANT_UPDATE', `Memperbarui merchant #${id}`);
      return res.status(200).json({ message: 'Merchant berhasil diperbarui!', merchant });
    } catch (err: any) {
      logger.error('MerchantController.update error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal memperbarui merchant.' });
    }
  };

  addMenuItem = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const item = await this.merchantService.addMenuItem(id, req.user!.id, req.user!.role, req.body);
      await AuditLogger.log(req.user!.id, 'MERCHANT_MENU_ADD', `Menambah menu "${item.name}" ke merchant #${id}`);
      return res.status(201).json({ message: 'Menu berhasil ditambahkan!', item });
    } catch (err: any) {
      logger.error('MerchantController.addMenuItem error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal menambahkan menu.' });
    }
  };

  updateMenuItem = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { itemId } = req.params;
      const item = await this.merchantService.updateMenuItem(itemId, req.user!.id, req.user!.role, req.body);
      await AuditLogger.log(req.user!.id, 'MERCHANT_MENU_UPDATE', `Memperbarui menu #${itemId}`);
      return res.status(200).json({ message: 'Menu berhasil diperbarui!', item });
    } catch (err: any) {
      logger.error('MerchantController.updateMenuItem error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal memperbarui menu.' });
    }
  };
}
