-- Permintaan lama yang sudah APPROVED tidak boleh tertinggal tanpa instrumen.
-- Mode hybrid-manual menjadikannya antrean transfer yang dapat diselesaikan
-- atau di-refund oleh Super Admin.
UPDATE "WithdrawalRequest"
SET
  status = 'PENDING_TRANSFER',
  "payoutProvider" = 'MANUAL',
  "providerStatus" = 'AWAITING_MANUAL_TRANSFER'
WHERE status = 'APPROVED'
  AND ("payoutProvider" IS NULL OR "payoutProvider" = 'MANUAL');
