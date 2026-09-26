#!/bin/sh
# Prépare le dossier publié par Netlify : uniquement les fichiers servis en production.
# server.cjs, OUVRIR_CONSTAT.cmd, docs/ et tests/ restent hors ligne.
set -eu
cd "$(dirname "$0")/.."
rm -rf dist
mkdir -p dist/vendor
cp index.html styles.css refinements.css sw.js offline.js \
   field-app.js drawing.js drafts.js visit-access.js \
   pdf-report.js word-report.js export-actions.js \
   dist/
cp vendor/pdf-lib.min.js vendor/docx.js \
   vendor/pdf-lib-LICENSE.md vendor/docx-LICENSE.txt \
   dist/vendor/
echo "Constat prêt dans dist/ :"
ls -R dist
