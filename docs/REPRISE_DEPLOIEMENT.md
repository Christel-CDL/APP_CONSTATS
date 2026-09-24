# Reprise pour déploiement — 24 septembre 2026

## Version publiée

Dernière version locale du 23 septembre, issue du dossier livré `outputs/constat`.
Les fichiers de l'application sont placés à la racine de ce dépôt : ouvrir `index.html` via un serveur web. Il n'y a pas de dossier `prototype/` dans cette publication.

## Mise en ligne confiée à Claude

- Application statique HTML/CSS/JavaScript, sans compilation ni installation npm.
- Publier `index.html`, les fichiers JavaScript et CSS référencés et le dossier `vendor/` en conservant leurs chemins relatifs.
- HTTPS nécessaire aux accès caméra, microphone et géolocalisation sur les appareils mobiles.
- `server.cjs` et `OUVRIR_CONSTAT.cmd` servent uniquement au lancement local, pas à la production.
- L'application Suivi PENA existe déjà chez Hostinger : utiliser un emplacement dédié pour Constat et préserver le site existant.
- Aucun déploiement Hostinger n'a été effectué lors de cette publication GitHub.

## État fonctionnel et limites

- Collecte de plusieurs photos par sujet, annotations, notes audio, brouillons IndexedDB, exports PDF et Word.
- Les données restent dans le navigateur de chaque appareil. Pas de synchronisation distante ni d'authentification intégrée.
- Les brouillons locaux ne sont pas transférés automatiquement vers une nouvelle adresse web : utiliser l'export/import JSON.
- Word est actuellement un export HTML avec extension `.doc`, pas un véritable `.docx`.
- La transcription dépend de la reconnaissance vocale du navigateur. La transcription différée des audios n'est pas implémentée.
- `visit-access.js` est un travail en cours, non chargé par `index.html` : la préparation groupée des autorisations et le suivi de position restent à intégrer et tester.
- La gomme a été ajoutée au code mais reste à valider visuellement sur iPad et Samsung.
- Carte OpenStreetMap et polices Google nécessitent une connexion Internet.
- Vérifier caméra, microphone, localisation et exports sur les appareils réels après déploiement.

Consulter `ETAT_AVANCEMENT.md` pour l'historique métier et `../LISEZ-MOI.txt` pour le mode d'emploi.

## Vérifications de publication

- Syntaxe des huit fichiers JavaScript et du serveur local vérifiée (huit fichiers au total).
- Présence des ressources locales référencées par `index.html` vérifiée.
- Cette publication conserve le code local ; elle ne constitue pas une nouvelle validation fonctionnelle complète.
