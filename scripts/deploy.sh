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
git pull
npm install
npm run build

if [ ! -f dist/personnage.fbx ]; then
  echo "Erreur: dist/personnage.fbx manquant — vérifie que assets/ est présent puis relance npm run build"
  exit 1
fi

echo "→ Build OK ($(du -sh dist | cut -f1))"
echo "→ Redémarre l'app Node dans le Manager Infomaniak (port 4001, start: npm start)"
