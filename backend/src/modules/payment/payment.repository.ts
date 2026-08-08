import { prisma } from '../../config/prisma';

export class PaymentRepository {
  findOrderById(orderId: string) {
    return prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true, driver: true, merchant: true, orderItems: true },
    });
  }

  markOrderPaid(orderId: string) {
    return prisma.order.update({
      where: { id: orderId },
      data: { isPaid: true },
    });
  }

  findPricingHistoryByOrderId(orderId: string) {
    return prisma.pricingHistory.findUnique({ where: { orderId } });
  }

  findPaymentProofByOrderId(orderId: string) {
    return prisma.paymentProof.findUnique({ where: { orderId } });
  }

  findPaymentProofById(id: string) {
    return prisma.paymentProof.findUnique({
      where: { id },
      include: { order: { include: { customer: true, driver: true, merchant: true, orderItems: true } } },
    });
  }

  listPendingPaymentProofs() {
    const TAKE_LIMIT = 100;
    return prisma.paymentProof.findMany({
      where: { status: 'PENDING_REVIEW' },
      include: {
        order: {
          include: {
            customer: { include: { user: { select: { fullName: true, email: true } } } },
            driver: { include: { user: { select: { fullName: true, email: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: TAKE_LIMIT,
    });
  }

  countPendingPaymentProofs() {
    return prisma.paymentProof.count({ where: { status: 'PENDING_REVIEW' } });
  }

  /** Upsert supaya bisa upload ulang setelah bukti sebelumnya ditolak (1 order = maksimal 1 baris proof). */
  createOrReplacePaymentProof(orderId: string, method: 'QRIS' | 'TRANSFER' | 'EWALLET', proofImageUrl: string, note?: string) {
    return prisma.paymentProof.upsert({
      where: { orderId },
      create: { orderId, method, proofImageUrl, note, status: 'PENDING_REVIEW' },
      update: { method, proofImageUrl, note, status: 'PENDING_REVIEW', reviewedBy: null, reviewedAt: null, reviewNote: null },
    });
  }

  updatePaymentProofStatus(id: string, status: 'APPROVED' | 'REJECTED', reviewedBy: string, reviewNote?: string) {
    return prisma.paymentProof.update({
      where: { id },
      data: { status, reviewedBy, reviewedAt: new Date(), reviewNote },
    });
  }
}
