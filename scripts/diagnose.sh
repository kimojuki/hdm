#!/bin/bash
# Diagnostic 503 — lancer en SSH depuis ~/sites/helldivermobiel.com
set -euo pipefail

SITE_ROOT="${SITE_ROOT:-$HOME/sites/helldivermobiel.com}"
cd "$SITE_ROOT"

echo "=== HDM diagnostic ==="
echo "Dossier : $(pwd)"
echo ""

echo "→ Fichiers clés"
for f in package.json server.mjs dist/index.html dist/personnage.fbx; do
  if [ -f "$f" ]; then echo "  OK  $f"; else echo "  MANQUANT  $f"; fi
done
echo ""

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
  echo "→ Node (nvm) : $(node -v 2>/dev/null || echo non disponible)"
else
  echo "→ Node : $(command -v node >/dev/null && node -v || echo non disponible)"
fi
echo ""

PORT="${PORT:-4001}"
echo "→ Test démarrage local (port $PORT, 3 s)…"
PORT="$PORT" timeout 3 node server.mjs &
PID=$!
sleep 1
if curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  echo "  OK  Node répond sur http://127.0.0.1:$PORT/health"
  curl -s "http://127.0.0.1:$PORT/health"
  echo ""
else
  echo "  ÉCHEC  Node ne répond pas sur le port $PORT"
  echo "  → Vérifie les logs dans le Manager Infomaniak (onglet Node.js)"
fi
kill "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
echo ""

echo "→ Config Manager Infomaniak attendue"
echo "  Dossier d'exécution : sites/helldivermobiel.com  (ou ./)"
echo "  Build               : npm install --include=dev && npm run build"
echo "  Lancement           : bash scripts/start.sh"
echo "  Port                : $PORT (identique au Manager)"
echo ""
echo "→ Si curl échoue en SSH mais le Manager est configuré :"
echo "  1. Onglet Node.js → version Node 20 LTS"
echo "  2. Redémarrer l'application"
echo "  3. Lire la console d'exécution dans le Manager"
