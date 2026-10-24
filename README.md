# APP_CONSTATS
Application de création de rapport de constats géolocalisés

## Accès et installation

En production, l'application est protégée par connexion (code envoyé par e-mail, comptes Airtable) et s'installe comme une icône sur l'écran d'accueil (iPad, Samsung). Chaque compte correspond à un profil (expertise judiciaire ou privée), choisi au lancement. Voir [accès et installation](docs/ACCES_ET_INSTALLATION.md).

## Lancer l'application

Depuis la racine du dépôt, avec Node.js installé :

```sh
node server.cjs
```

`server.cjs` est le serveur de développement, sans compte (profil « Mode local »). La production utilise `server/index.cjs`.

Ouvrir http://127.0.0.1:8765/ dans le navigateur. Sous Windows, `OUVRIR_CONSTAT.cmd` permet également le lancement.

## Déploiement

Application statique, sans compilation. `index.html` se trouve à la racine du dépôt et utilise les fichiers JavaScript/CSS voisins ainsi que `vendor/`.

Hébergement : VPS Hostinger (VM 1102696, Europe), à l'adresse prévue https://constats.srv1102696.hstgr.cloud.
Push sur `main` → GitHub Actions publie l'image `ghcr.io/christel-cdl/app-constats:latest` (paquet à mettre en visibilité **publique**) → hPanel déploie le projet Docker **`app-constats`** décrit dans [`deploy/docker-compose.constats.yml`](deploy/docker-compose.constats.yml). Ce projet est distinct du projet `root` (Traefik, n8n, Suivi PENA), qu'il ne modifie pas. Voir [les consignes de reprise](docs/REPRISE_DEPLOIEMENT.md).

## Utilisation

Voir [le mode d'emploi](LISEZ-MOI.txt) et [l'état d'avancement](docs/ETAT_AVANCEMENT.md).
Les brouillons et les dossiers sont sauvegardés localement dans le navigateur, sans synchronisation entre appareils. « Mes dossiers » permet de créer un dossier (nom, référence, type, client, adresse, statut) et d'y rattacher des constats ; le tableau de bord n'affiche plus que ces données réelles.

## Modèles de rapport CDL EXPERT (27 septembre 2026)

Rapport HTML autonome au modèle Expertise judiciaire, Expertise privée ou Constat, selon le type du dossier. En expertise judiciaire, aucune donnée nominative (parties, juridiction, n° RG) n'est saisie ni conservée, à l'exception du nom court du demandeur contenu dans le code du dossier (voir ci-dessous) : le bloc nominatif du rapport est laissé vide et complété après génération. En expertise privée, l'application produit aussi le procès-verbal de réception et le procès-verbal de levée des réserves (HTML et Word), la levée reprenant les réserves du PV de réception. Voir [les modèles de rapport](docs/MODELES_RAPPORT.md).

## Version stabilisée du 24 septembre 2026

- Préparation des accès caméra, microphone et géolocalisation en début de visite.
- Gomme et annotations intégrées ; sauvegarde de la visite avant de changer de brouillon.
- Dossier, référence et date modifiables.
- Vrais exports Word `.docx` et PDF, avec respect des cases d'inclusion.
- Chargement hors connexion après une première ouverture réussie ; la carte et la dictée en ligne nécessitent Internet.

La transcription différée et les connexions aux services externes restent à intégrer. Les essais sur iPad/Samsung et le rendu dans Word sont à confirmer.

Les [tests reproductibles](tests/README.md) utilisent des données et des périphériques simulés.

## Lien avec le tableau de suivi des expertises judiciaires (22 octobre 2026)

Le tableau Excel `Tableau_suivi_expertises.xlsx` (OneDrive, dossier « Dossiers en cours », nom désormais sans date) est la référence. Sa colonne « Code Constats » (EJ + n° d'expertise + « _ » + nom court du demandeur, ex. `EJ24-358_NOM`) est reportée dans le champ **Code Constats** de la table Projets d'Airtable, qui sert de nom du dossier dans l'application ; la **Référence** reprend le seul n° (`EJ24-358`), clé de rattachement des constats. Seules les expertises « En cours » y figurent ; seuls le code, le n° et le type sont repris : ni parties, ni juridiction, ni n° RG, ni observations. Depuis le 24/10/2026, le serveur relit le tableau dans OneDrive à chaque ouverture du profil judiciaire et sur le bouton « 🔎 Rechercher dans le tableau de suivi » (mise en place : [accès et installation](docs/ACCES_ET_INSTALLATION.md)). Choix de Christel du 22/10/2026 : le nom court du demandeur est conservé dans le code.
