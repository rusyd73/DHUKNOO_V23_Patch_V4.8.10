ALTER TABLE "Wallet"
ADD COLUMN IF NOT EXISTS "earningsBalance"
DECIMAL(12, 2) NOT NULL DEFAULT 0.00;

CREATE INDEX IF NOT EXISTS "Wallet_earningsBalance_idx"
ON "Wallet" ("earningsBalance");