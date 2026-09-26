# APP_CONSTATS
Application de création de rapport de constats géolocalisés

## Lancer l'application

Depuis la racine du dépôt, avec Node.js installé :

```sh
node server.cjs
```

Ouvrir http://127.0.0.1:8765/ dans le navigateur. Sous Windows, `OUVRIR_CONSTAT.cmd` permet également le lancement.

## Déploiement

Application statique, sans compilation. `index.html` se trouve à la racine du dépôt et utilise les fichiers JavaScript/CSS voisins ainsi que `vendor/`.

Hébergement : VPS Hostinger (VM 1102696, Europe), à l'adresse prévue https://constats.srv1102696.hstgr.cloud.
Push sur `main` → GitHub Actions publie l'image `ghcr.io/christel-cdl/app-constats:latest` (paquet à mettre en visibilité **publique**) → hPanel déploie le projet Docker **`app-constats`** décrit dans [`deploy/docker-compose.constats.yml`](deploy/docker-compose.constats.yml). Ce projet est distinct du projet `root` (Traefik, n8n, Suivi PENA), qu'il ne modifie pas. Voir [les consignes de reprise](docs/REPRISE_DEPLOIEMENT.md).

## Utilisation

Voir [le mode d'emploi](LISEZ-MOI.txt) et [l'état d'avancement](docs/ETAT_AVANCEMENT.md).
Les brouillons sont sauvegardés localement dans le navigateur, sans synchronisation entre appareils.

## Version stabilisée du 24 septembre 2026

- Préparation des accès caméra, microphone et géolocalisation en début de visite.
- Gomme et annotations intégrées ; sauvegarde de la visite avant de changer de brouillon.
- Dossier, référence et date modifiables.
- Vrais exports Word `.docx` et PDF, avec respect des cases d'inclusion.
- Chargement hors connexion après une première ouverture réussie ; la carte et la dictée en ligne nécessitent Internet.

La transcription différée et les connexions aux services externes restent à intégrer. Les essais sur iPad/Samsung et le rendu dans Word sont à confirmer.

Les [tests reproductibles](tests/README.md) utilisent des données et des périphériques simulés.
