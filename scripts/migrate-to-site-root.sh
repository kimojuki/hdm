#!/bin/bash
# Migration UNIQUE : déplace hdm/* vers ~/sites/helldivermobiel.com
# Après cette étape, le dossier d'exécution Infomaniak est TOUJOURS la racine du site.
set -euo pipefail

SITE_ROOT="${SITE_ROOT:-$HOME/sites/helldivermobiel.com}"
cd "$SITE_ROOT"

if [ -f package.json ] && [ ! -d hdm ]; then
  echo "Déjà à la racine du site ($SITE_ROOT) — rien à migrer."
  exit 0
fi

[ -f "$SITE_ROOT/hdm/package.json" ] || {
  echo "Erreur: $SITE_ROOT/hdm/package.json introuvable"
  echo "Clone le dépôt dans hdm/ puis relance ce script."
  exit 1
}

echo "→ Migration $SITE_ROOT/hdm → $SITE_ROOT"

# Anciens fichiers statiques copiés à la main (hors dist/)
rm -f index.html test.html index.html.jeu server-test.html 2>/dev/null || true
rm -rf assets batiment ennemie environement guns solmap1 vehicule 2>/dev/null || true
rm -f personnage.fbx 2>/dev/null || true

shopt -s dotglob nullglob
mv hdm/* .
rmdir hdm 2>/dev/null || rm -rf hdm

echo "→ Migration OK"
echo "→ Dossier d'exécution Infomaniak : sites/helldivermobiel.com"
echo "→ Ensuite : bash scripts/deploy.sh"
