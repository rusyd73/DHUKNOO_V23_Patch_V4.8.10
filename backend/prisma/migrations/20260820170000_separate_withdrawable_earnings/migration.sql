-- Fix 12: pisahkan saldo penghasilan yang dapat dicairkan dari saldo top-up.
ALTER TABLE "Wallet"
ADD COLUMN "earningsBalance" DECIMAL(12,2) NOT NULL DEFAULT 0.00;

-- Backfill konservatif dari histori transaksi. Semua debit lama ikut
-- mengurangi penghasilan agar top-up lama tidak dapat ikut dicairkan.
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
WHERE calculated.id = w.id;

CREATE INDEX "Wallet_earningsBalance_idx" ON "Wallet"("earningsBalance");
