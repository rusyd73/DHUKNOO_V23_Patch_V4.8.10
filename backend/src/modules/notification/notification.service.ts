import { NotificationRepository } from './notification.repository';

export class NotificationService {
  private notificationRepo = new NotificationRepository();

  getForUser(userId: string, limit = 30, offset = 0) {
    return this.notificationRepo.listForUser(userId, limit, offset);
  }
}
