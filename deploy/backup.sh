#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# LaunchForge — Sauvegarde de la base SQLite + des uploads
#
# Sauvegarde À CHAUD (sans arrêter l'app) :
#   • SQLite : commande ".backup" = snapshot cohérent même en mode WAL.
#   • uploads/ : archive tar.gz.
# Conserve les 7 dernières sauvegardes.
#
# Usage manuel :   bash deploy/backup.sh
# Cron quotidien (3h du matin), à mettre dans `crontab -e` :
#   0 3 * * * cd /root/launchforge && bash deploy/backup.sh >> /var/log/launchforge-backup.log 2>&1
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

VOLUME="launchforge_launchforge_data"   # <project>_<volume> (préfixe = nom du dossier)
BACKUP_DIR="${BACKUP_DIR:-/root/launchforge-backups}"
KEEP=7
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"

# Le nom réel du volume dépend du dossier projet. On le résout dynamiquement.
if ! docker volume inspect "$VOLUME" >/dev/null 2>&1; then
  VOLUME="$(docker volume ls --format '{{.Name}}' | grep 'launchforge_data' | head -n1)"
fi
if [[ -z "${VOLUME:-}" ]]; then
  echo "!! Volume de données introuvable" >&2
  exit 1
fi

echo "==> Sauvegarde du volume '$VOLUME' vers $BACKUP_DIR ($STAMP)"

docker run --rm \
  -v "${VOLUME}:/data" \
  -v "${BACKUP_DIR}:/backup" \
  alpine:3.20 sh -c "
    set -e
    apk add --no-cache sqlite >/dev/null
    if [ -f /data/launchforge.db ]; then
      sqlite3 /data/launchforge.db \".backup '/backup/db-${STAMP}.sqlite'\"
      gzip -f /backup/db-${STAMP}.sqlite
    fi
    if [ -d /data/uploads ]; then
      tar czf /backup/uploads-${STAMP}.tar.gz -C /data uploads
    fi
  "

# ── Rotation : ne garder que les KEEP dernières de chaque type ───────────────
prune() {
  local pattern="$1"
  ls -1t "$BACKUP_DIR"/$pattern 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
}
prune 'db-*.sqlite.gz'
prune 'uploads-*.tar.gz'

echo "==> Sauvegardes actuelles :"
ls -lh "$BACKUP_DIR"
