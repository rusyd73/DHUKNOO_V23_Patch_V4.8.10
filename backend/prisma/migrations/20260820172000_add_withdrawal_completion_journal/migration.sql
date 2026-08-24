-- Jurnal penutup agar dana yang telah ditransfer tidak terlihat terus tertahan.
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'WITHDRAWAL_COMPLETED';
