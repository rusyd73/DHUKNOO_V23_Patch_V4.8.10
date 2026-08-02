import { Router } from 'express';
import { ReviewController } from './review.controller';
import { authenticateToken, authorizeRoles } from '../../core/middleware/auth.middleware';
import { validateBody } from '../../core/middleware/validation.middleware';
import { createReviewSchema } from '../../core/validation/schemas';

const router = Router();
const reviewController = new ReviewController();

// Hanya CUSTOMER yang bisa memberi ulasan, dan hanya untuk order miliknya sendiri.
router.post(
  '/',
  authenticateToken as any,
  authorizeRoles('CUSTOMER') as any,
  validateBody(createReviewSchema),
  reviewController.submit as any
);

// Siapa saja yang login bisa melihat rating & ulasan seorang driver
router.get('/driver/:driverId', authenticateToken as any, reviewController.getForDriver as any);

export const reviewRouter = router;
