-- Harus berada di migration terpisah agar penambahan enum pada migration
-- sebelumnya sudah COMMIT sebelum nilainya dipakai oleh PostgreSQL/Supabase.
INSERT INTO "Transaction" (
  id, "walletId", type, amount, description, "idempotencyKey", "createdAt"
)
SELECT
  gen_random_uuid(),
  w.id,
  'WITHDRAWAL_COMPLETED'::"TransactionType",
  0,
  'Pencairan selesai ' || wr.id || COALESCE(' · Ref: ' || wr."manualTransferReference", ''),
  'withdrawal-completed-' || wr.id,
  COALESCE(wr."completedAt", NOW())
FROM "WithdrawalRequest" wr
JOIN "Wallet" w ON w."userId" = wr."userId"
WHERE wr.status = 'COMPLETED'
ON CONFLICT ("idempotencyKey") DO NOTHING;
