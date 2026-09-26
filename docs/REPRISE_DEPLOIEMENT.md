# Reprise pour déploiement — 24 septembre 2026

## Version publiée

Version stabilisée le 24 septembre, à partir de la version locale du 23 septembre.
Les fichiers de l'application sont placés à la racine de ce dépôt : ouvrir `index.html` via un serveur web. Il n'y a pas de dossier `prototype/` dans cette publication.

## Mise en ligne confiée à Claude

- Application statique HTML/CSS/JavaScript, sans compilation ni installation npm.
- Publier `index.html`, les fichiers JavaScript et CSS référencés, `sw.js` et le dossier `vendor/` en conservant leurs chemins relatifs. Les bibliothèques PDF et DOCX sont embarquées avec leurs licences.
- HTTPS nécessaire aux accès caméra, microphone et géolocalisation sur les appareils mobiles.
- `server.cjs` et `OUVRIR_CONSTAT.cmd` servent uniquement au lancement local, pas à la production.
- Hébergement retenu le 26 septembre 2026 : Netlify (offre gratuite), à la place du VPS Hostinger. Le pipeline Docker/nginx/GHCR prévu pour le VPS a été retiré du dépôt.
- Constat n'est plus déployé sur le VPS Hostinger, qui reste dédié à Suivi PENA. Le service worker garde sa portée relative `./`.

## Paramétrage Netlify

- `netlify.toml` : commande `sh scripts/build-netlify.sh`, dossier publié `dist`. Laisser vides les champs « Build command » et « Publish directory » de l'interface : le fichier du dépôt fait foi.
- Branche de production : `main`. Chaque pull request obtient un aperçu de déploiement distinct (adresse différente, donc brouillons distincts).
- En-têtes : HTTPS strict, `Permissions-Policy` limitant caméra, micro et géolocalisation au site, `noindex` pour les moteurs de recherche, `sw.js` jamais mis en cache.
- HTTPS est fourni automatiquement par Netlify (adresse `*.netlify.app` ou domaine personnalisé).
- Le site est public pour toute personne connaissant l'adresse. Les données restent dans le navigateur de l'appareil ; aucune n'est transmise à Netlify. La protection par mot de passe de Netlify n'est pas incluse dans l'offre gratuite.

## État fonctionnel et limites

- Collecte de plusieurs photos par sujet, annotations, notes audio, brouillons IndexedDB, exports PDF et Word.
- Les données restent dans le navigateur de chaque appareil. Pas de synchronisation distante ni d'authentification intégrée.
- Les brouillons locaux ne sont pas transférés automatiquement vers une nouvelle adresse web : utiliser l'export/import JSON.
- Word est désormais un vrai `.docx` avec images incorporées et textes modifiables, Arial 12, A4 portrait, deux photos par ligne et deux lignes de photos maximum entre sauts de page explicites. Les textes longs peuvent occuper des pages supplémentaires.
- La transcription dépend de la reconnaissance vocale du navigateur. La transcription différée des audios n'est pas implémentée.
- Les accès caméra/micro/localisation sont préparés au démarrage d'un nouveau constat. Les flux sont réutilisés et mis en pause hors capture ; un bouton permet de les suspendre. Le navigateur garde la maîtrise des autorisations et peut les redemander après fermeture ou révocation.
- Le suivi de localisation alimente les captures avec une position de moins de 15 secondes. Une position ancienne, une importation ou une photo prise via le sélecteur natif ne reçoit pas automatiquement de coordonnées. L'association manuelle reste disponible.
- Les boutons stylo/gomme sont intégrés. L'effacement conserve le fond et la photo originale.
- Le nom de dossier, la référence et la date sont modifiables et conservés dans les brouillons et les rapports. Les autres données du tableau de bord restent des exemples de présentation.
- Le service worker prépare le chargement sans réseau après une première visite réussie en HTTPS. Attendre le message « Application disponible hors connexion ». Les photos, audios, brouillons et exports restent locaux. La carte et la dictée dépendant d'un service distant nécessitent Internet. Les polices sont locales.
- Pour chaque prochaine version, modifier le nom du cache dans `sw.js`. Une mise à jour s'active après fermeture de tous les onglets Constat ; éviter de forcer une actualisation pendant une saisie.
- Vérifier caméra, microphone, localisation et exports sur les appareils réels après déploiement.

Consulter `ETAT_AVANCEMENT.md` pour l'historique métier et `../LISEZ-MOI.txt` pour le mode d'emploi.

## Vérifications de publication

- Scénarios reproductibles : `tests/browser.cjs`, `tests/edge-cases.cjs`, `tests/reports.cjs`. Voir `tests/README.md`.
- Parcours navigateur avec sources caméra/audio simulées : préparation unique, captures avec GPS simulé, import sans GPS, gomme, audio, reprise du brouillon, exports Word/PDF, rechargement et export sans réseau.
- Cas d'échec : annulation pendant une demande d'accès, rejet d'une position périmée, sauvegarde invalide et échec d'écriture empêchant le changement de visite.
- Contenu du DOCX contrôlé dans l'archive OOXML ; contenu et rendu PDF contrôlés. Le rendu DOCX dans Word/LibreOffice reste à vérifier : LibreOffice n'est pas installé dans l'environnement de test.
- Ces tests ne remplacent pas les essais sur les appareils réels.

## Travail externe restant

- Transcription différée : confiée à Claude lors du déploiement, selon le choix de Christel du 24 septembre. Choisir le moteur et l'hébergement avec elle avant intégration. Les audios peuvent déjà être téléchargés et leur texte saisi/collé après la visite.
- Authentification, synchronisation multi-appareils, SharePoint et automatisations : non intégrés dans ce lot de stabilisation.
- Tester sur l'adresse HTTPS définitive, puis importer une sauvegarde JSON pour vérifier le transfert d'une visite locale.
