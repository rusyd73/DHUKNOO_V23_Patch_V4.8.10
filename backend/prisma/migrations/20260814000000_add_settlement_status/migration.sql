-- 🆕 FIX P0 "Financial State Machine" (audit a1.4, 14 Agustus 2026).
-- Lihat komentar lengkap di enum SettlementStatus dan field
-- Order.settlementStatus pada prisma/schema.prisma.
--
-- Order yang SUDAH ADA di database sebelum migration ini dibackfill
-- berdasarkan isPaid yang sudah tercatat: isPaid=true -> SETTLED,
-- isPaid=false -> PENDING (default kolom). Ini konsisten dengan makna
-- lama isPaid, dan TIDAK menandai order lama sebagai RETRY_REQUIRED
-- secara retroaktif (kita tidak tahu dari data lama mana yang memang
-- belum pernah dicoba vs yang pernah gagal -- default paling aman
-- adalah PENDING, bukan mengada-adakan riwayat kegagalan yang tidak
-- benar-benar terjadi).

CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'SETTLED', 'RETRY_REQUIRED', 'FAILED');

ALTER TABLE "Order" ADD COLUMN "settlementStatus" "SettlementStatus" NOT NULL DEFAULT 'PENDING';

UPDATE "Order" SET "settlementStatus" = 'SETTLED' WHERE "isPaid" = true;

CREATE INDEX "Order_settlementStatus_idx" ON "Order"("settlementStatus");
