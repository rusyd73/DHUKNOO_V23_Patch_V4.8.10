-- Membawa transaksi uji MOCK/PENDING yang sudah terlanjur menggantung ke
-- antrean transfer manual agar dapat diselesaikan atau direfund oleh Admin.
UPDATE "WithdrawalRequest"
SET
  "status" = 'PENDING_TRANSFER',
  "payoutProvider" = 'MANUAL',
  "providerStatus" = 'AWAITING_ADMIN_TRANSFER',
  "externalPayoutId" = NULL
WHERE
  "status" = 'PROCESSING'
  AND "payoutProvider" = 'MOCK'
  AND COALESCE("providerStatus", '') IN ('PENDING', 'CREATING');
