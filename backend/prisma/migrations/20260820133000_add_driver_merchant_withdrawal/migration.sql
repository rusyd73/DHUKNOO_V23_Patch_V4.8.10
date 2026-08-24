ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'WITHDRAWAL_HOLD';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'WITHDRAWAL_REFUND';

CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'FAILED');
CREATE TYPE "WithdrawalMethod" AS ENUM ('BANK_TRANSFER', 'EWALLET');

CREATE TABLE "WithdrawalRequest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "method" "WithdrawalMethod" NOT NULL,
  "destinationProvider" TEXT NOT NULL,
  "destinationAccount" TEXT NOT NULL,
  "destinationName" TEXT NOT NULL,
  "note" TEXT,
  "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "reviewedBy" TEXT,
  "reviewNote" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WithdrawalRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WithdrawalRequest_status_createdAt_idx" ON "WithdrawalRequest"("status", "createdAt");
CREATE INDEX "WithdrawalRequest_userId_createdAt_idx" ON "WithdrawalRequest"("userId", "createdAt");
CREATE INDEX "WithdrawalRequest_userId_status_idx" ON "WithdrawalRequest"("userId", "status");
ALTER TABLE "WithdrawalRequest" ADD CONSTRAINT "WithdrawalRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
