-- FIX: reconcile Wallet.earningsBalance schema drift safely.
--
-- Why this migration exists even though 20260820170000 already introduced
-- earningsBalance:
-- production/test databases can reach a state where Prisma's migration history
-- says an older migration was applied while the physical column is absent.
-- This forward-only migration repairs that drift without editing migration
-- history or deleting existing wallet data.

ALTER TABLE "Wallet"
ADD COLUMN IF NOT EXISTS "earningsBalance" DECIMAL(12,2) NOT NULL DEFAULT 0.00;

-- Conservative backfill, but only for rows that still have zero earnings.
-- Existing non-zero earningsBalance values are never overwritten.
WITH calculated AS (
  SELECT
    w.id,
    GREATEST(
      0,
      LEAST(
        w.balance,
        COALESCE(SUM(
          CASE
            WHEN t.type IN ('EARNING', 'MERCHANT_EARNING') AND t.amount > 0 THEN t.amount
            WHEN t.amount < 0 THEN t.amount
            WHEN t.type = 'WITHDRAWAL_REFUND' AND t.amount > 0 THEN t.amount
            ELSE 0
          END
        ), 0)
      )
    ) AS earnings_balance
  FROM "Wallet" w
  LEFT JOIN "Transaction" t ON t."walletId" = w.id
  GROUP BY w.id, w.balance
)
UPDATE "Wallet" w
SET "earningsBalance" = calculated.earnings_balance
FROM calculated
WHERE calculated.id = w.id
  AND w."earningsBalance" = 0
  AND calculated.earnings_balance > 0;

CREATE INDEX IF NOT EXISTS "Wallet_earningsBalance_idx"
ON "Wallet"("earningsBalance");
