#!/bin/bash
# ── Prisma DB Push — o2switch ─────────────────────────────────────────────────
# Run this from cPanel Terminal to sync the Prisma schema to the MySQL database.
# Uses the project-local Prisma 5.22.0 (not the server's global Prisma 7.x).
#
# Usage:
#   bash ~/grubano.com/scripts/server/prisma-push.sh

set -e

# Activate Node 24 virtual environment (o2switch nodevenv)
source /home/deyi0010/nodevenv/grubano.com/24/bin/activate

cd /home/deyi0010/grubano.com

echo "▶  Using Node: $(node --version)"
echo "▶  Using npx:  $(npx --version)"
echo "▶  Prisma version in project: $(cat node_modules/prisma/package.json | grep '"version"' | head -1)"
echo ""

# Use the project-local prisma binary explicitly to avoid the global v7 conflict
./node_modules/.bin/prisma db push

echo ""
echo "✓ Done — schema is in sync with the database."
