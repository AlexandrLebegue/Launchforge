# Déploiement LaunchForge — VPS Hetzner + Caddy (HTTPS auto)

Architecture la moins chère pour ce stack (SQLite + uploads locaux + workers
permanents) : **une seule VM** avec disque persistant. Hetzner **CX22**
(2 vCPU, 4 Go RAM, 40 Go SSD, ~4,5 €/mois) est confortable pour `sharp` et les
uploads vidéo.

```
Internet ──▶ Caddy (80/443, TLS Let's Encrypt) ──▶ app:3000 (Express + SQLite)
                                                      └─ volume: SQLite + uploads
```

## Fichiers

| Fichier | Rôle |
|---|---|
| `Caddyfile` | Reverse-proxy + HTTPS automatique |
| `docker-compose.prod.yml` | App (réseau interne) + Caddy (80/443) |
| `.env.production.example` | Modèle des variables d'env de prod |
| `deploy/hetzner-setup.sh` | Provisioning one-shot (Docker, swap, UFW, lancement) |
| `deploy/backup.sh` | Sauvegarde à chaud SQLite + uploads (cron) |

---

## Étapes

### 1. Créer le VPS
- Hetzner Cloud → nouveau serveur → **CX22**, image **Ubuntu 24.04**.
- Ajouter ta clé SSH. Noter l'**IPv4** du serveur (ex. `203.0.113.42`).

### 2. Pointer le DNS (Google Cloud DNS)
Ton domaine est géré dans Cloud DNS (zone `alexandre-lebegue-com`). Ajoute un
enregistrement **A** `launchforge` → IP du VPS.

Via `gcloud` (remplace `VPS_IP`) :
```bash
gcloud dns record-sets create launchforge.alexandre-lebegue.com. \
  --zone=alexandre-lebegue-com \
  --type=A --ttl=300 \
  --rrdatas=VPS_IP
```
Ou dans la console : **Détails de la zone → Ajouter un rrset standard** →
Nom `launchforge`, Type `A`, TTL `300`, Données = IP du VPS.

Vérifier la propagation : `dig +short launchforge.alexandre-lebegue.com`
(doit renvoyer l'IP du VPS). ⚠️ Fais ça **avant** l'étape 4, sinon Caddy ne
peut pas obtenir le certificat HTTPS.

### 3. Récupérer le code + configurer les secrets
En SSH sur le VPS (`ssh root@VPS_IP`) :
```bash
git clone <URL_DU_REPO> launchforge
cd launchforge
cp .env.production.example .env
nano .env        # remplir au minimum JWT_SECRET et OPENROUTER_API_KEY
```
Générer un JWT_SECRET : `openssl rand -hex 32`

### 4. Provisionner + lancer
```bash
sudo bash deploy/hetzner-setup.sh
```
Le script installe Docker, crée 2 Go de swap, ouvre le pare-feu (SSH/80/443),
build l'image et démarre la stack. Caddy obtient le certificat TLS
automatiquement une fois le DNS propagé.

Suivre les logs : `docker compose -f docker-compose.prod.yml logs -f`

➡️ Application en ligne : **https://launchforge.alexandre-lebegue.com**

### 5. Sauvegardes automatiques
```bash
crontab -e
# ajouter :
0 3 * * * cd /root/launchforge && bash deploy/backup.sh >> /var/log/launchforge-backup.log 2>&1
```

---

## Opérations courantes

```bash
# Déployer une nouvelle version
git pull && docker compose -f docker-compose.prod.yml up -d --build

# Statut / logs
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f app

# Redémarrer
docker compose -f docker-compose.prod.yml restart

# Sauvegarde manuelle
bash deploy/backup.sh
```

## Notes
- L'app n'expose **pas** le port 3000 publiquement : seul Caddy est joignable
  (80/443). Plus sûr.
- Le volume `caddy_data` contient les certificats TLS — ne pas le supprimer
  (rate-limit Let's Encrypt en cas de ré-émissions répétées).
- `VITE_ADMIN_EMAILS` doit être présent dans `.env` **avant** le build pour que
  le lien `/admin` apparaisse dans la sidebar (il est inliné au build du front).
