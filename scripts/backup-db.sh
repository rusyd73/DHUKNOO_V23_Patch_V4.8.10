#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# Backup database Postgres OBAMA ke file .sql.gz terkompresi.
#
# Cara pakai (manual):
#   ./scripts/backup-db.sh
#
# Cara pakai (terjadwal, contoh crontab jam 2 pagi setiap hari):
#   0 2 * * * cd /path/ke/project && ./scripts/backup-db.sh >> /var/log/obama-backup.log 2>&1
#
# Retensi: file backup lebih tua dari BACKUP_RETENTION_DAYS hari akan
# dihapus otomatis agar disk tidak penuh.
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

CONTAINER_NAME="${POSTGRES_CONTAINER_NAME:-obama-postgres}"
DB_USER="${POSTGRES_USER:-obama_user}"
DB_NAME="${POSTGRES_DB:-obama_db}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/obama_db_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "📦 Membuat backup database '${DB_NAME}' dari container '${CONTAINER_NAME}'..."

docker exec -t "$CONTAINER_NAME" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --clean --if-exists \
  | gzip > "$BACKUP_FILE"

if [ -s "$BACKUP_FILE" ]; then
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo "✅ Backup berhasil: ${BACKUP_FILE} (${SIZE})"
else
  echo "❌ Backup gagal atau file kosong!" >&2
  rm -f "$BACKUP_FILE"
  exit 1
fi

echo "🧹 Menghapus backup yang lebih tua dari ${RETENTION_DAYS} hari..."
find "$BACKUP_DIR" -name "obama_db_*.sql.gz" -type f -mtime +"$RETENTION_DAYS" -delete

echo "🗄️  Backup selesai. Total file backup saat ini: $(find "$BACKUP_DIR" -name 'obama_db_*.sql.gz' | wc -l)"
