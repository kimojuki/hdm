#!/bin/bash
# À lancer depuis ~/sites/helldivermobiel.com quand le projet est dans ./hdm
set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
[ -f "$ROOT/hdm/package.json" ] || { echo "Erreur: $ROOT/hdm/package.json introuvable"; exit 1; }
rm -f index.html test.html index.html.jeu 2>/dev/null || true
rm -rf assets batiment ennemie environement guns solmap1 vehicule 2>/dev/null || true
rm -f personnage.fbx 2>/dev/null || true
shopt -s dotglob nullglob
mv hdm/* .
rmdir hdm 2>/dev/null || rm -rf hdm
echo "Migration OK — package.json est maintenant à la racine du site."
