import crypto from 'crypto';
import { prisma } from '../../config/prisma';
import { AppError } from '../../core/errors/AppError';
import { logger } from '../../config/logger';
import { SocketService } from '../../websocket/socket';
import { WalletRepository } from './wallet.repository';

type ProviderResult = { externalId: string; status: string };

export class PayoutService {
  private walletRepo = new WalletRepository();

  private provider() {
    return String(process.env.PAYOUT_PROVIDER || 'MOCK').trim().toUpperCase();
  }

  private mode() {
    return String(process.env.PAYOUT_MODE || 'MANUAL').trim().toUpperCase();
  }

  private mapInternalStatus(status: string) {
    const normalized = status.toUpperCase();
    if (normalized === 'SUCCEEDED') return 'COMPLETED';
    if (['FAILED', 'REVERSED', 'REJECTED', 'CANCELLED', 'COMPLIANCE_REJECTED'].includes(normalized)) return 'FAILED';
    return 'PROCESSING';
  }

  private async sendToProvider(request: any): Promise<ProviderResult> {
    const provider = this.provider();
    if (provider === 'MOCK') {
      const status = String(process.env.PAYOUT_MOCK_RESULT || 'PENDING').toUpperCase();
      return { externalId: `mock-${request.id}`, status };
    }
    if (provider !== 'XENDIT') throw new AppError(`PAYOUT_PROVIDER ${provider} belum didukung.`, 503);

    const apiKey = String(process.env.XENDIT_SECRET_API_KEY || '');
    if (!apiKey) throw new AppError('XENDIT_SECRET_API_KEY belum dikonfigurasi.', 503);
    const referenceId = request.payoutReference || `withdrawal-${request.id}`;
    const channelCode = request.destinationProvider.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const body = {
      reference_id: referenceId,
      recipient: {
        type: 'INDIVIDUAL',
        given_names: request.destinationName,
        relationship: 'EMPLOYEE',
        account_details: {
          currency: 'IDR', account_country: 'ID', account_holder_name: request.destinationName,
          account_number: request.destinationAccount, routing_type_1: 'CHANNEL_CODE', routing_value_1: channelCode,
        },
      },
      payout_details: { source_currency: 'IDR', destination_currency: 'IDR', destination_amount: Math.round(Number(request.amount) * 100) },
      source_of_fund: 'BUSINESS_INCOME', purpose_code: 'SALARY',
      description: `DHUKNOO earnings ${request.id.slice(0, 8)}`,
      metadata: { withdrawal_request_id: request.id, user_id: request.userId },
    };
    const response = await fetch(String(process.env.XENDIT_PAYOUT_URL || 'https://api.xendit.co/v3/payouts'), {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
        'Content-Type': 'application/json', 'Idempotency-key': referenceId, 'Api-version': '2025-09-01',
      },
      body: JSON.stringify(body),
    });
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new AppError(payload.message || payload.error_code || 'Provider payout menolak permintaan.', 502);
    return { externalId: payload.payout_id, status: payload.status || 'ACCEPTED' };
  }

  async initiate(requestId: string) {
    const request = await prisma.withdrawalRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new AppError('Permintaan pencairan tidak ditemukan.', 404);
    if (request.status !== 'PENDING_REVIEW') return request;
    if (this.mode() === 'MANUAL') {
      return prisma.withdrawalRequest.update({
        where: { id: request.id },
        data: { status: 'PENDING_TRANSFER', payoutProvider: 'MANUAL', providerStatus: 'AWAITING_ADMIN_TRANSFER' },
      });
    }
    if (this.mode() !== 'AUTOMATIC') throw new AppError('PAYOUT_MODE harus MANUAL atau AUTOMATIC.', 503);
    const reference = request.payoutReference || `withdrawal-${request.id}`;
    await prisma.withdrawalRequest.update({ where: { id: request.id }, data: { payoutProvider: this.provider(), payoutReference: reference, status: 'PROCESSING', processedAt: new Date(), providerStatus: 'CREATING' } });
    try {
      const result = await this.sendToProvider({ ...request, payoutReference: reference });
      return this.applyProviderStatus(request.id, result.status, result.externalId);
    } catch (error: any) {
      logger.error(`[PAYOUT] initiation failed ${request.id}: ${error.message}`);
      return this.applyProviderStatus(request.id, 'FAILED', undefined, error.message || 'PAYOUT_CREATE_FAILED');
    }
  }

  async applyProviderStatus(requestId: string, providerStatus: string, externalId?: string, failureCode?: string) {
    const target = this.mapInternalStatus(providerStatus);
    const request = await prisma.withdrawalRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new AppError('Withdrawal payout tidak ditemukan.', 404);
    if (request.status === 'COMPLETED' || request.status === 'FAILED') return request;

    const updated = await prisma.$transaction(async (tx) => {
      const { count } = await tx.withdrawalRequest.updateMany({
        where: { id: request.id, status: { in: ['PENDING_REVIEW', 'APPROVED', 'PROCESSING'] } },
        data: { status: target as any, providerStatus, externalPayoutId: externalId || request.externalPayoutId, failureCode: failureCode || null, completedAt: target === 'COMPLETED' ? new Date() : null },
      });
      if (count !== 1) return tx.withdrawalRequest.findUniqueOrThrow({ where: { id: request.id } });
      if (target === 'FAILED') {
        let wallet = await tx.wallet.findUnique({ where: { userId: request.userId } });
      if (!wallet) wallet = await tx.wallet.create({ data: { userId: request.userId, balance: 0, earningsBalance: 0 } });
        await this.walletRepo.applyDelta(tx, wallet.id, Number(request.amount), 'WITHDRAWAL_REFUND', `Refund payout otomatis ${request.id}`, undefined, `withdrawal-refund-${request.id}`);
      }
      if (target === 'COMPLETED') {
        let wallet = await tx.wallet.findUnique({ where: { userId: request.userId } });
        if (!wallet) wallet = await tx.wallet.create({ data: { userId: request.userId, balance: 0, earningsBalance: 0 } });
        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            type: 'WITHDRAWAL_COMPLETED',
            amount: 0,
            description: `Pencairan otomatis selesai ${request.id}${externalId ? ` · Ref: ${externalId}` : ''}`,
            idempotencyKey: `withdrawal-completed-${request.id}`,
          },
        });
      }
      return tx.withdrawalRequest.findUniqueOrThrow({ where: { id: request.id } });
    });
    SocketService.emitToUser(request.userId, 'withdrawal_status_changed', { requestId: request.id, status: updated.status, providerStatus });
    SocketService.emitToAdmins('withdrawal_status_changed', { requestId: request.id, userId: request.userId, status: updated.status, providerStatus });
    return updated;
  }

  verifyXenditWebhook(token: string) {
    const expected = String(process.env.XENDIT_WEBHOOK_TOKEN || '');
    if (!expected || !token) return false;
    const a = Buffer.from(expected); const b = Buffer.from(token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  async handleXenditWebhook(payload: any) {
    const data = payload?.data || payload;
    const reference = data?.reference_id;
    const request = reference ? await prisma.withdrawalRequest.findUnique({ where: { payoutReference: reference } }) : null;
    if (!request) throw new AppError('Referensi payout tidak dikenal.', 404);
    return this.applyProviderStatus(request.id, data.status || String(payload?.event || '').split('.').pop(), data.payout_id, data.failure_code);
  }
}
