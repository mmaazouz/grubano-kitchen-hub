#!/usr/bin/env bash
# =============================================================================
# scripts/deploy.sh — Déploiement automatisé Grubano vers o2switch
# =============================================================================
# Usage :
#   ./scripts/deploy.sh            → déploiement complet
#   ./scripts/deploy.sh --skip-build  → skip le build local (redéploie tel quel)
#   ./scripts/deploy.sh --dry-run     → simule sans rien uploader
#
# Pré-requis :
#   - Clé SSH configurée : ssh-copy-id deyi0010@<IP_O2SWITCH>
#   - rsync installé localement
#   - Node.js 18.x sur o2switch (sélectionner dans cPanel > Setup Node.js App)
# =============================================================================

set -euo pipefail

# ─── CONFIG ──────────────────────────────────────────────────────────────────
SSH_USER="deyi0010"
SSH_HOST="${GRUBANO_SSH_HOST:-}"          # Défini via env ou arg
REMOTE_DIR="/home/deyi0010/grubano.com"
LOCAL_BUILD_DIR=".next/standalone"
SKIP_BUILD=false
DRY_RUN=false
NODE_VERSION="18"

# Couleurs terminal
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# ─── FONCTIONS ───────────────────────────────────────────────────────────────
log_info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
log_step()    { echo -e "\n${BOLD}▶ $*${NC}"; }

usage() {
  echo "Usage: $0 [--skip-build] [--dry-run] [--host <ip_o2switch>]"
  exit 1
}

# ─── PARSE ARGS ──────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) SKIP_BUILD=true ;;
    --dry-run)    DRY_RUN=true; log_warn "Mode DRY-RUN activé — aucun fichier uploadé" ;;
    --host)       SSH_HOST="$2"; shift ;;
    -h|--help)    usage ;;
    *) log_error "Argument inconnu : $1"; usage ;;
  esac
  shift
done

# ─── VÉRIFICATIONS PRÉ-DÉPLOIEMENT ───────────────────────────────────────────
log_step "Vérifications pré-déploiement"

if [[ -z "$SSH_HOST" ]]; then
  log_error "SSH_HOST non défini. Utilise : --host <ip_o2switch>"
  log_error "Ou exporte : export GRUBANO_SSH_HOST=<ip_o2switch>"
  exit 1
fi

if ! command -v rsync &> /dev/null; then
  log_error "rsync non installé. Installe-le avec : sudo apt install rsync"
  exit 1
fi

if ! ssh -o ConnectTimeout=10 -o BatchMode=yes "${SSH_USER}@${SSH_HOST}" "exit" 2>/dev/null; then
  log_error "Connexion SSH impossible à ${SSH_USER}@${SSH_HOST}"
  log_error "Configure ta clé SSH : ssh-copy-id ${SSH_USER}@${SSH_HOST}"
  exit 1
fi

log_success "SSH OK → ${SSH_USER}@${SSH_HOST}"

# ─── BUILD LOCAL ─────────────────────────────────────────────────────────────
if [[ "$SKIP_BUILD" == false ]]; then
  log_step "Build Next.js 14 (standalone)"

  # Vérifier que .env.local existe
  if [[ ! -f ".env.local" ]]; then
    log_error ".env.local manquant. Copie .env.local.example et remplis les valeurs."
    exit 1
  fi

  log_info "npm run build..."
  npm run build

  if [[ ! -d "$LOCAL_BUILD_DIR" ]]; then
    log_error "Build échoué : dossier .next/standalone/ introuvable"
    exit 1
  fi

  log_success "Build terminé → .next/standalone/"
else
  log_warn "Build ignoré (--skip-build)"
  if [[ ! -d "$LOCAL_BUILD_DIR" ]]; then
    log_error "Dossier .next/standalone/ introuvable. Lance sans --skip-build."
    exit 1
  fi
fi

# ─── PRÉPARER LES ASSETS STANDALONE ─────────────────────────────────────────
log_step "Préparation des assets"

# Next.js standalone nécessite que public/ et .next/static/ soient copiés
# dans le dossier standalone
log_info "Copie public/ → .next/standalone/public/"
if [[ -d "public" ]]; then
  cp -r public/ .next/standalone/public/
fi

log_info "Copie .next/static/ → .next/standalone/.next/static/"
if [[ -d ".next/static" ]]; then
  mkdir -p .next/standalone/.next/static
  cp -r .next/static/ .next/standalone/.next/static/
fi

# Copier le wrapper Passenger (remplace le server.js généré par Next.js
# qui contient des chemins absolus codés en dur du poste de build Windows)
log_info "Copie server.js Passenger → .next/standalone/ (remplace le généré)"
cp server.js .next/standalone/server.js

# Copier .env.local
log_info "Copie .env.local → .next/standalone/"
cp .env.local .next/standalone/.env.local

log_success "Assets préparés"

# ─── DÉPLOIEMENT RSYNC ───────────────────────────────────────────────────────
log_step "Upload vers o2switch (rsync)"

RSYNC_FLAGS="-avz --delete --progress"
RSYNC_EXCLUDES=(
  "--exclude=node_modules/"
  "--exclude=.git/"
  "--exclude=*.log"
)

if [[ "$DRY_RUN" == true ]]; then
  RSYNC_FLAGS="$RSYNC_FLAGS --dry-run"
fi

log_info "Synchronisation vers ${SSH_USER}@${SSH_HOST}:${REMOTE_DIR}/"

rsync $RSYNC_FLAGS \
  "${RSYNC_EXCLUDES[@]}" \
  .next/standalone/ \
  "${SSH_USER}@${SSH_HOST}:${REMOTE_DIR}/"

log_success "Fichiers uploadés"

# ─── POST-DÉPLOIEMENT SUR LE SERVEUR ─────────────────────────────────────────
if [[ "$DRY_RUN" == false ]]; then
  log_step "Configuration post-déploiement sur o2switch"

  ssh "${SSH_USER}@${SSH_HOST}" bash << REMOTE_SCRIPT
    set -e
    cd ${REMOTE_DIR}

    echo "→ Node version : \$(node --version)"
    echo "→ npm version  : \$(npm --version)"

    # S'assurer que prisma est disponible et générer le client
    if [ -f "node_modules/.bin/prisma" ]; then
      echo "→ Génération Prisma client..."
      node_modules/.bin/prisma generate --schema=prisma/schema.prisma 2>/dev/null || true
    fi

    # Vérifier que server.js existe
    if [ ! -f "server.js" ]; then
      echo "ERREUR : server.js introuvable dans ${REMOTE_DIR}"
      exit 1
    fi

    echo "✅ Déploiement prêt dans ${REMOTE_DIR}"
    echo ""
    echo "⚠️  Redémarre manuellement l'app dans cPanel > Setup Node.js App"
    echo "   → Clique sur 'Restart' pour que Passenger prenne les changements"
REMOTE_SCRIPT

  log_success "Post-déploiement terminé"
fi

# ─── RÉSUMÉ FINAL ────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  ✅ DÉPLOIEMENT GRUBANO TERMINÉ        ${NC}"
echo -e "${BOLD}${GREEN}════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Serveur${NC}  : ${SSH_USER}@${SSH_HOST}"
echo -e "  ${BOLD}Chemin${NC}   : ${REMOTE_DIR}"
echo -e "  ${BOLD}URL${NC}      : https://grubano.com"
echo ""
if [[ "$DRY_RUN" == false ]]; then
  echo -e "  ${YELLOW}ACTION REQUISE :${NC} Redémarre l'app dans cPanel > Setup Node.js App"
fi
echo ""
