#!/bin/bash
# Point d'entrée Infomaniak — à utiliser comme commande de lancement : bash scripts/start.sh
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f server.mjs ]; then
  echo "[HDM] ERREUR: server.mjs introuvable dans $(pwd)"
  exit 1
fi

if [ ! -f dist/index.html ]; then
  echo "[HDM] ERREUR: dist/index.html manquant — lance d'abord: npm run build"
  exit 1
fi

if [ -z "${PORT:-}" ]; then
  echo "[HDM] AVERTISSEMENT: variable PORT non définie (Infomaniak doit la fournir)"
fi

echo "[HDM] Démarrage depuis $(pwd) — PORT=${PORT:-?}"
exec node server.mjs
