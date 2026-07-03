#!/bin/bash
# Déploiement SANS Node — Apache sert directement le contenu de public/
# Utilise si le 503 persiste (hébergement Web Apache sans proxy Node actif).
set -euo pipefail

SITE_ROOT="${SITE_ROOT:-$HOME/sites/helldivermobiel.com}"
cd "$SITE_ROOT"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
fi

echo "→ Build…"
npm install --include=dev
npm run build

echo "→ Publication statique dans public/"
rm -rf public
mkdir -p public
cp -a dist/. public/

cat > public/.htaccess << 'EOF'
DirectoryIndex index.html
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule ^ index.html [L]
</IfModule>
EOF

echo "→ OK — configure Apache pour servir le dossier public/"
echo "  Ou désactive Node dans le Manager et pointe le site vers public/"
