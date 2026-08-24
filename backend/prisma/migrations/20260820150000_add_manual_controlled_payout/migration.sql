ALTER TYPE "WithdrawalStatus" ADD VALUE IF NOT EXISTS 'PENDING_TRANSFER';

ALTER TABLE "WithdrawalRequest"
  ADD COLUMN "manualTransferReference" TEXT,
  ADD COLUMN "manualTransferredAt" TIMESTAMP(3);

CREATE INDEX "WithdrawalRequest_manualTransferredAt_idx" ON "WithdrawalRequest"("manualTransferredAt");
