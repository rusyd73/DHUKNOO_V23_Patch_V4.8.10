import { Response } from 'express';
import { AuthenticatedRequest } from '../../core/middleware/auth.middleware';
import { ReviewService } from './review.service';
import { AppError } from '../../core/errors/AppError';
import { logger } from '../../config/logger';
import { AuditLogger } from '../../core/logging/audit.logger';

export class ReviewController {
  private reviewService = new ReviewService();

  submit = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { orderId, rating, comment } = req.body;

      const review = await this.reviewService.submitReview(userId, orderId, rating, comment);

      await AuditLogger.log(userId, 'SUBMIT_REVIEW', `Memberi ulasan rating ${rating} untuk order #${orderId}`);

      return res.status(201).json({ message: 'Ulasan berhasil dikirim!', review });
    } catch (err: any) {
      logger.error('ReviewController.submit error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal mengirim ulasan.' });
    }
  };

  getForDriver = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { driverId } = req.params;
      const result = await this.reviewService.getDriverReviews(driverId);
      return res.status(200).json(result);
    } catch (err: any) {
      logger.error('ReviewController.getForDriver error: %s', err.message);
      return res.status(500).json({ error: 'Gagal mengambil ulasan driver.' });
    }
  };
}
