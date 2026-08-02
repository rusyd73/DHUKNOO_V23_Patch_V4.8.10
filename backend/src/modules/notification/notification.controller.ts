import { Response } from 'express';
import { AuthenticatedRequest } from '../../core/middleware/auth.middleware';
import { NotificationService } from './notification.service';
import { logger } from '../../config/logger';

export class NotificationController {
  private notificationService = new NotificationService();

  list = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const limit = req.query.limit ? Number(req.query.limit) : 30;
      const offset = req.query.offset ? Number(req.query.offset) : 0;
      const notifications = await this.notificationService.getForUser(userId, limit, offset);
      return res.status(200).json({ notifications });
    } catch (err: any) {
      logger.error('NotificationController.list error: %s', err.message);
      return res.status(500).json({ error: 'Gagal mengambil notifikasi.' });
    }
  };
}
