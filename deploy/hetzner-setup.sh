#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# LaunchForge — Provisioning d'un VPS Hetzner (Ubuntu 22.04/24.04)
#
# À lancer EN ROOT sur un serveur fraîchement créé, depuis la racine du repo :
#     git clone <repo> launchforge && cd launchforge
#     cp .env.production.example .env   # puis remplir les secrets
#     sudo bash deploy/hetzner-setup.sh
#
# Le script est idempotent : on peut le relancer sans casse.
#   1. Installe Docker Engine + plugin compose (si absent)
#   2. Crée un swapfile de 2 Go (sécurité mémoire : sharp + gros uploads)
#   3. Configure le pare-feu UFW (SSH + 80 + 443)
#   4. Vérifie la présence de .env
#   5. Build + lance la stack de prod (app + Caddy)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
err() { printf '\n\033[1;31m!! %s\033[0m\n' "$*" >&2; }

if [[ "$(id -u)" -ne 0 ]]; then
  err "Lance ce script en root (sudo bash deploy/hetzner-setup.sh)"
  exit 1
fi

# ── 1. Docker ────────────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  log "Installation de Docker Engine + compose plugin"
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
else
  log "Docker déjà installé : $(docker --version)"
fi

# ── 2. Swap (2 Go) ───────────────────────────────────────────────────────────
if [[ ! -f /swapfile ]]; then
  log "Création d'un swapfile de 2 Go"
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
else
  log "Swapfile déjà présent"
fi

# ── 3. Pare-feu UFW ──────────────────────────────────────────────────────────
if command -v ufw >/dev/null 2>&1 || apt-get install -y ufw; then
  log "Configuration du pare-feu UFW (SSH, 80, 443)"
  ufw allow OpenSSH || ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
fi

# ── 4. Vérification .env ─────────────────────────────────────────────────────
if [[ ! -f .env ]]; then
  err "Fichier .env manquant. Fais : cp .env.production.example .env puis remplis JWT_SECRET et OPENROUTER_API_KEY."
  exit 1
fi
if ! grep -q '^JWT_SECRET=.\+' .env || ! grep -q '^OPENROUTER_API_KEY=.\+' .env; then
  err "JWT_SECRET ou OPENROUTER_API_KEY est vide dans .env. Remplis-les avant de relancer."
  exit 1
fi

# ── 5. Build + lancement ─────────────────────────────────────────────────────
log "Build et démarrage de la stack de production"
docker compose -f docker-compose.prod.yml up -d --build

log "Terminé. Statut :"
docker compose -f docker-compose.prod.yml ps

cat <<'EOF'

────────────────────────────────────────────────────────────────────────────
  Prochaines étapes :
   • Assure-toi que l'enregistrement DNS A est en place :
       launchforge.alexandre-lebegue.com  ->  IP de ce serveur
     (Caddy ne peut obtenir le certificat HTTPS qu'une fois le DNS propagé.)
   • Suivre les logs :   docker compose -f docker-compose.prod.yml logs -f
   • Une fois le DNS OK : https://launchforge.alexandre-lebegue.com
────────────────────────────────────────────────────────────────────────────
EOF
