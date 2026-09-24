# Vérification de Constat

Ces scripts utilisent Node.js, Playwright, JSZip et docx 9.6.1. Installer les dépendances de test séparément des fichiers déployés :

```sh
npm install --no-save playwright jszip docx@9.6.1
```

Démarrer `node server.cjs` (port 8765), puis définir `TEST_URL=http://127.0.0.1:8765/` dans le terminal des tests. La valeur par défaut des scripts est le port 8877 pour les essais isolés. `PLAYWRIGHT_CHANNEL` vaut `msedge` par défaut ; utiliser un navigateur Chromium installé compatible.

Exécuter dans cet ordre :

```sh
node tests/browser.cjs
node tests/reports.cjs
node tests/edge-cases.cjs
```

`TEST_OUTPUT` permet de choisir le dossier des résultats. Chaque test navigateur ouvre un profil isolé et le mode `?verification=1`, avec une base IndexedDB distincte. Aucun brouillon utilisateur n'est utilisé. Les flux caméra/audio et la position sont simulés ; le stockage, les pistes médias, les enregistrements et les exports utilisent les API réelles du navigateur.

Les tests couvrent le parcours complet, la reprise, les inclusions DOCX, les fichiers PDF, les rapports longs, le mode hors connexion et plusieurs protections contre les pertes de données. Le contrôle visuel Word et les permissions matérielles sur Safari iPad/Chrome Android restent manuels.
