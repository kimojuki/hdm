#!/usr/bin/env bash
# Déploiement prod Infomaniak — git sync + build + pm2 restart (comme zombie-survival)
set -euo pipefail

APP_DIR="${HDM_APP_DIR:-$HOME/sites/helldivermobiel.com}"
PM2_NAME="${HDM_PM2_NAME:-hdm}"
BRANCH="${HDM_DEPLOY_BRANCH:-main}"
LOG_DIR="${HDM_DEPLOY_LOG_DIR:-$HOME/logs}"
LOG_FILE="$LOG_DIR/hdm-deploy.log"

export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$HOME/.nvm/nvm.sh"
fi
for _node_bin in "$HOME"/.nvm/versions/node/*/bin; do
  [ -d "$_node_bin" ] && PATH="$_node_bin:$PATH"
done
export PATH

mkdir -p "$LOG_DIR"
cd "$APP_DIR"

log() {
  echo "[$(date -Iseconds)] $*" | tee -a "$LOG_FILE"
}

log "=== deploy start (branch=$BRANCH, pm2=$PM2_NAME) ==="

git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

npm install --include=dev
npm run build

rm -f index.html admin.html 2>/dev/null || true
rm -rf batiment ennemie environement guns solmap1 vehicule 2>/dev/null || true
rm -f personnage.fbx 2>/dev/null || true

if ! command -v pm2 >/dev/null 2>&1; then
  log "ERROR: pm2 introuvable — installe-le : npm install -g pm2"
  exit 1
fi

if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_NAME" 2>&1 | tee -a "$LOG_FILE"
else
  pm2 start ecosystem.config.cjs 2>&1 | tee -a "$LOG_FILE"
  pm2 save 2>&1 | tee -a "$LOG_FILE" || true
fi

sleep 1
curl -sf "http://127.0.0.1:4001/health" 2>&1 | tee -a "$LOG_FILE" || log "WARN: health check failed"

log "=== deploy done ==="
