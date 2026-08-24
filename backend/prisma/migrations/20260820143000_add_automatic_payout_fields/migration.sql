ALTER TABLE "WithdrawalRequest"
  ADD COLUMN "payoutProvider" TEXT,
  ADD COLUMN "payoutReference" TEXT,
  ADD COLUMN "externalPayoutId" TEXT,
  ADD COLUMN "providerStatus" TEXT,
  ADD COLUMN "failureCode" TEXT;

CREATE UNIQUE INDEX "WithdrawalRequest_payoutReference_key" ON "WithdrawalRequest"("payoutReference");
CREATE UNIQUE INDEX "WithdrawalRequest_externalPayoutId_key" ON "WithdrawalRequest"("externalPayoutId");
CREATE INDEX "WithdrawalRequest_payoutProvider_providerStatus_idx" ON "WithdrawalRequest"("payoutProvider", "providerStatus");
