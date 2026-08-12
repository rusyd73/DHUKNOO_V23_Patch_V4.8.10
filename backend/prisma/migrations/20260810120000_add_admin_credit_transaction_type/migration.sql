-- Tambah nilai ADMIN_CREDIT ke enum TransactionType.
-- Dipakai oleh POST /api/admin/wallet/credit (WalletAdminService.creditUserWallet)
-- sebagai satu-satunya jalur sah admin mengkredit saldo user LAIN secara
-- langsung, di luar antrean TopupRequest. Dipisah dari TOPUP supaya jejak
-- audit tetap jelas mana top-up biasa (inisiatif user, direview admin) vs
-- kredit manual admin (mis. kompensasi kesalahan sistem, refund manual).
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'ADMIN_CREDIT';
