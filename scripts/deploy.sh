#!/bin/bash
# Déploiement Infomaniak — à lancer depuis ~/sites/helldivermobiel.com
# Le dossier d'exécution Node doit TOUJOURS être la racine du site (pas ./hdm).
set -euo pipefail

SITE_ROOT="${SITE_ROOT:-$HOME/sites/helldivermobiel.com}"
cd "$SITE_ROOT"

if [ ! -f package.json ]; then
  echo "Erreur: package.json introuvable dans $SITE_ROOT"
  echo "Si le dépôt est encore dans ./hdm, lance une fois: bash hdm/scripts/migrate-to-site-root.sh"
  exit 1
fi

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
fi

echo "→ Déploiement HDM dans $SITE_ROOT"
git fetch origin
git reset --hard origin/main
npm install
npm run build

if [ ! -f dist/personnage.fbx ]; then
  echo "Erreur: dist/personnage.fbx manquant — vérifie que assets/ est présent puis relance npm run build"
  exit 1
fi

# Apache peut servir index.html (dev) à la racine au lieu de proxy → Node/dist.
# Sans ça : spinner infini (le navigateur charge /src/main.js qui n'existe pas en prod).
rm -f index.html admin.html 2>/dev/null || true

# Anciennes copies statiques hors dist/ (déploiements manuels)
rm -rf batiment ennemie environement guns solmap1 vehicule 2>/dev/null || true
rm -f personnage.fbx 2>/dev/null || true

echo "→ Build OK ($(du -sh dist | cut -f1))"
echo "→ index.html dev supprimé à la racine (prod = dist/ via Node)"
echo ""
echo "Manager Infomaniak (onglet Node.js) :"
echo "  Dossier d'exécution : sites/helldivermobiel.com"
echo "  Port                : 4001"
echo "  Build               : npm install --include=dev && npm run build"
echo "  Lancement           : bash scripts/start.sh"
echo "  Node.js             : 20 LTS"
echo ""
echo "→ Redémarre l'app dans le Manager, puis :"
echo "  bash scripts/diagnose.sh"
