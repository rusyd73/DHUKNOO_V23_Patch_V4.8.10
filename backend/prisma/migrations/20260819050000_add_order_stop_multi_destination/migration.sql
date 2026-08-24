-- 🆕 MULTI-DESTINATION (Fase 1: skema database)
--
-- Menambahkan tabel `OrderStop` untuk mendukung order dengan LEBIH DARI
-- 1 tujuan (mis. customer mau mampir ke 2-3 lokasi berbeda dalam satu
-- perjalanan). Ini murni ADDITIVE:
--   - Kolom `Order.dropoffAddress/dropoffLat/dropoffLng` yang sudah ada
--     TIDAK DIUBAH SAMA SEKALI -- semua order lama & order baru yang
--     cuma 1 tujuan tetap berjalan persis seperti sebelumnya, TANPA
--     baris `OrderStop` sama sekali.
--   - `OrderStop` hanya terisi kalau customer sengaja memilih lebih dari
--     1 tujuan saat checkout (ditangani di application code, bukan di
--     migrasi ini).
--
-- Migrasi ini AMAN dijalankan di database production yang sudah berisi
-- data -- tidak menyentuh/mengubah tabel atau kolom yang sudah ada,
-- hanya CREATE TYPE + CREATE TABLE baru.

-- CreateEnum
CREATE TYPE "OrderStopStatus" AS ENUM ('PENDING', 'ARRIVED', 'COMPLETED', 'SKIPPED');

-- CreateTable
CREATE TABLE "OrderStop" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "status" "OrderStopStatus" NOT NULL DEFAULT 'PENDING',
    "arrivedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderStop_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderStop_orderId_sequence_key" ON "OrderStop"("orderId", "sequence");

-- CreateIndex
CREATE INDEX "OrderStop_orderId_status_idx" ON "OrderStop"("orderId", "status");

-- AddForeignKey
ALTER TABLE "OrderStop" ADD CONSTRAINT "OrderStop_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
