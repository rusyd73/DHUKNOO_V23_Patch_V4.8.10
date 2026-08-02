#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# Restore database Postgres OBAMA dari file backup .sql.gz.
#
# Cara pakai:
#   ./scripts/restore-db.sh ./backups/obama_db_20260711_020000.sql.gz
#
# PERINGATAN: proses ini akan MENIMPA data yang ada di database saat ini
# (backup dibuat dengan --clean sehingga akan DROP objek lama sebelum restore).
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Penggunaan: $0 <path-ke-file-backup.sql.gz>" >&2
  exit 1
fi

BACKUP_FILE="$1"
CONTAINER_NAME="${POSTGRES_CONTAINER_NAME:-obama-postgres}"
DB_USER="${POSTGRES_USER:-obama_user}"
DB_NAME="${POSTGRES_DB:-obama_db}"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "❌ File backup tidak ditemukan: ${BACKUP_FILE}" >&2
  exit 1
fi

read -p "⚠️  Ini akan MENIMPA database '${DB_NAME}' saat ini. Lanjutkan? (ketik 'ya' untuk konfirmasi): " CONFIRM
if [ "$CONFIRM" != "ya" ]; then
  echo "Dibatalkan."
  exit 0
fi

echo "♻️  Merestore dari ${BACKUP_FILE}..."
gunzip -c "$BACKUP_FILE" | docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME"

echo "✅ Restore selesai."
