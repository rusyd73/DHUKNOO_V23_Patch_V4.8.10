-- 🆕 FIX KONSEPTUAL "Ledger masih bukan immutable ledger murni" (audit
-- lanjutan). Dua perbaikan:
--
-- 1. Kolom balanceAfter -- snapshot saldo wallet TEPAT SETELAH entry
--    ini diterapkan, supaya tiap baris jadi fakta historis yang
--    berdiri sendiri (self-contained), bukan cuma delta yang harus
--    di-SUM() ulang dan bisa diam-diam salah kalau ada entry yang
--    hilang.
--
-- 2. TRIGGER Postgres yang MENOLAK UPDATE dan DELETE pada tabel
--    "Ledger" -- SEBELUMNYA immutability Ledger cuma "konvensi kode"
--    (LedgerService tidak pernah memanggil .update()/.delete()), yang
--    artinya masih bergantung 100% pada disiplin programmer -- bug di
--    masa depan, akses langsung ke DB (mis. lewat psql/DBA tooling),
--    atau kode baru yang lupa aturan ini SEMUA bisa diam-diam mengubah
--    atau menghapus riwayat keuangan tanpa ada yang tahu. Trigger ini
--    menegakkan immutability di LEVEL DATABASE -- bahkan kalau kode
--    aplikasi punya bug atau seseorang punya akses langsung ke DB
--    (tapi bukan superuser yang sengaja BYPASS/DISABLE trigger), baris
--    Ledger BENAR-BENAR tidak bisa diubah/dihapus setelah ditulis.
--    Koreksi kesalahan pembukuan HARUS lewat entry PEMBALIK baru
--    (mis. type 'CORRECTION' / 'REVERSAL') yang tetap tercatat sebagai
--    baris baru, BUKAN mengedit baris lama -- persis prinsip akuntansi
--    double-entry yang sesungguhnya (tidak pernah menghapus jejak).
ALTER TABLE "Ledger" ADD COLUMN IF NOT EXISTS "balanceAfter" DECIMAL(12,2);

CREATE OR REPLACE FUNCTION ledger_prevent_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Ledger tidak boleh diubah atau dihapus -- ledger bersifat immutable (append-only). Gunakan entry pembalik/koreksi baru, bukan UPDATE/DELETE.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_no_update ON "Ledger";
CREATE TRIGGER ledger_no_update
  BEFORE UPDATE ON "Ledger"
  FOR EACH ROW
  EXECUTE FUNCTION ledger_prevent_mutation();

DROP TRIGGER IF EXISTS ledger_no_delete ON "Ledger";
CREATE TRIGGER ledger_no_delete
  BEFORE DELETE ON "Ledger"
  FOR EACH ROW
  EXECUTE FUNCTION ledger_prevent_mutation();
