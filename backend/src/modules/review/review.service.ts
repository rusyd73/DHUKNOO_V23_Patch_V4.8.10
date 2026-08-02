import { prisma } from '../../config/prisma';
import { ReviewRepository } from './review.repository';
import { AppError, NotFoundError, ForbiddenError } from '../../core/errors/AppError';

export class ReviewService {
  private reviewRepo = new ReviewRepository();

  async submitReview(customerUserId: string, orderId: string, rating: number, comment?: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true },
    });

    if (!order) {
      throw new NotFoundError('Order tidak ditemukan!');
    }
    if (order.customer.userId !== customerUserId) {
      throw new ForbiddenError('Anda hanya bisa memberi ulasan untuk order milik Anda sendiri!');
    }
    if (order.status !== 'COMPLETED') {
      throw new AppError('Ulasan hanya bisa diberikan untuk order yang sudah COMPLETED!', 400);
    }
    if (!order.driverId) {
      throw new AppError('Order ini tidak memiliki driver yang bisa diberi ulasan!', 400);
    }

    const existing = await this.reviewRepo.findByOrderId(orderId);
    if (existing) {
      throw new AppError('Order ini sudah pernah diberi ulasan sebelumnya!', 409);
    }

    return this.reviewRepo.create({
      orderId,
      driverId: order.driverId,
      rating,
      comment,
    });
  }

  async getDriverReviews(driverId: string) {
    const [reviews, ratingStats] = await Promise.all([
      this.reviewRepo.listByDriverId(driverId),
      this.reviewRepo.getDriverAverageRating(driverId),
    ]);
    return { reviews, ...ratingStats };
  }
}
