#!/usr/bin/env bash
# =============================================================================
# ~/deploy-staging.sh — Manual staging deploy trigger
# =============================================================================
# Upload once:
#   scp scripts/server/deploy-staging.sh deyi0010@109.234.165.222:~/deploy-staging.sh
#   ssh deyi0010@109.234.165.222 "chmod +x ~/deploy-staging.sh"
#
# Usage:
#   ~/deploy-staging.sh                    # expects ~/grubano-staging.zip
#   ~/deploy-staging.sh ~/my-custom.zip
# =============================================================================

set -euo pipefail

DEPLOY_PATH="/home/deyi0010/app.grubano.com"
NODE_ENV_BIN="/home/deyi0010/nodevenv/app.grubano.com/24/bin"
ZIP="${1:-/home/deyi0010/grubano-staging.zip}"

info()  { echo -e "\033[36m  →  $*\033[0m"; }
ok()    { echo -e "\033[32m  ✓  $*\033[0m"; }
warn()  { echo -e "\033[33m  ⚠  $*\033[0m"; }
fatal() { echo -e "\033[31m  ✗  $*\033[0m"; exit 1; }

echo ""
echo "════════════════════════════════════════"
echo "  Grubano — Staging Deploy"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "════════════════════════════════════════"

[ -f "$ZIP" ]           || fatal "ZIP not found: $ZIP"
[ -d "$DEPLOY_PATH" ]   || mkdir -p "$DEPLOY_PATH"

info "ZIP:         $ZIP ($(du -sh "$ZIP" | cut -f1))"
info "Deploy path: $DEPLOY_PATH"

info "Extracting ZIP"
unzip -o "$ZIP" -d "$DEPLOY_PATH/"
ok "ZIP extracted"

info "Fixing permissions"
chmod -R 755 "$DEPLOY_PATH/.next/"
chmod -R 755 "$DEPLOY_PATH/public/" 2>/dev/null || true
chmod 644    "$DEPLOY_PATH/server.js"
chmod 600    "$DEPLOY_PATH/.env.local" 2>/dev/null || true
ok "Permissions set"

info "Running prisma db push (staging)"
source "$NODE_ENV_BIN/activate"
cd "$DEPLOY_PATH"
npx prisma db push --accept-data-loss 2>&1 | tail -10
ok "Schema synced"

info "Restarting Passenger"
mkdir -p "$DEPLOY_PATH/tmp"
touch "$DEPLOY_PATH/tmp/restart.txt"
ok "Restart triggered"

sleep 10
STATUS=$(curl -sL -o /dev/null -w "%{http_code}" https://app.grubano.com/dashboard 2>/dev/null || echo "000")
[ "$STATUS" = "200" ] && ok "Health check → HTTP $STATUS" || warn "Health check → HTTP $STATUS"

rm -f "$ZIP"

echo ""
echo "════════════════════════════════════════"
echo "  ✅ Staging deploy complete!"
echo "     https://app.grubano.com/dashboard"
echo "════════════════════════════════════════"
echo ""
