#!/usr/bin/env bash
# =============================================================================
# ~/deploy-production.sh — Manual production deploy trigger
# =============================================================================
# Upload this file once to the o2switch server:
#   scp scripts/server/deploy-production.sh deyi0010@109.234.165.222:~/deploy-production.sh
#   ssh deyi0010@109.234.165.222 "chmod +x ~/deploy-production.sh"
#
# Usage (from cPanel Terminal or local SSH):
#   ~/deploy-production.sh                     # expects ~/grubano-prod.zip
#   ~/deploy-production.sh ~/my-custom.zip     # use a custom ZIP
#
# This is the manual-trigger equivalent of the GitHub Actions workflow.
# Use it for emergency hot-fixes when you need to deploy without CI.
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
DEPLOY_PATH="/home/deyi0010/grubano.com"
NODE_ENV_BIN="/home/deyi0010/nodevenv/grubano.com/24/bin"
ZIP="${1:-/home/deyi0010/grubano-prod.zip}"
BACKUP_DIR="$HOME/backups/prod-$(date +%Y%m%d-%H%M%S)"

# ── Helpers ───────────────────────────────────────────────────────────────────
info()  { echo -e "\033[36m  →  $*\033[0m"; }
ok()    { echo -e "\033[32m  ✓  $*\033[0m"; }
warn()  { echo -e "\033[33m  ⚠  $*\033[0m"; }
fatal() { echo -e "\033[31m  ✗  $*\033[0m"; exit 1; }

echo ""
echo "════════════════════════════════════════"
echo "  Grubano — Production Deploy"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "════════════════════════════════════════"

# ── 1. Pre-flight checks ──────────────────────────────────────────────────────
[ -f "$ZIP" ]           || fatal "ZIP not found: $ZIP"
[ -d "$DEPLOY_PATH" ]   || fatal "Deploy path missing: $DEPLOY_PATH"
command -v unzip >/dev/null || fatal "unzip not installed"

info "ZIP:         $ZIP ($(du -sh "$ZIP" | cut -f1))"
info "Deploy path: $DEPLOY_PATH"

# ── 2. Backup current .next/server ───────────────────────────────────────────
info "Backing up current build → $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
[ -d "$DEPLOY_PATH/.next/server" ] && \
  cp -r "$DEPLOY_PATH/.next/server" "$BACKUP_DIR/" && \
  ok "Backup saved" || warn "No existing build to back up"

# ── 3. Extract ZIP ────────────────────────────────────────────────────────────
info "Extracting $ZIP → $DEPLOY_PATH/"
unzip -o "$ZIP" -d "$DEPLOY_PATH/"
ok "ZIP extracted"

# ── 4. Fix permissions ────────────────────────────────────────────────────────
info "Fixing permissions"
chmod -R 755 "$DEPLOY_PATH/.next/"
chmod -R 755 "$DEPLOY_PATH/public/"  2>/dev/null || true
chmod 644    "$DEPLOY_PATH/server.js"
chmod 600    "$DEPLOY_PATH/.env.local" 2>/dev/null || true
ok "Permissions set"

# ── 5. Push Prisma schema changes ─────────────────────────────────────────────
info "Running prisma db push"
source "$NODE_ENV_BIN/activate"
cd "$DEPLOY_PATH"
npx prisma db push --accept-data-loss 2>&1 | tail -10
ok "Schema synced"

# ── 6. Restart Passenger ──────────────────────────────────────────────────────
info "Restarting Passenger"
mkdir -p "$DEPLOY_PATH/tmp"
touch "$DEPLOY_PATH/tmp/restart.txt"
ok "Passenger restart triggered"

# ── 7. Health check ───────────────────────────────────────────────────────────
info "Waiting 10s for Passenger to restart..."
sleep 10
STATUS=$(curl -sL -o /dev/null -w "%{http_code}" https://grubano.com/dashboard 2>/dev/null || echo "000")
if [ "$STATUS" = "200" ]; then
  ok "Health check passed — HTTP $STATUS"
else
  warn "Health check returned HTTP $STATUS (site may still be starting)"
fi

# ── 8. Cleanup ────────────────────────────────────────────────────────────────
rm -f "$ZIP"
info "Cleaned up ZIP"

echo ""
echo "════════════════════════════════════════"
echo "  ✅ Production deploy complete!"
echo "     https://grubano.com/dashboard"
echo "════════════════════════════════════════"
echo ""
