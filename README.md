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

La mise en ligne sur Hostinger est confiée à Claude. Voir [les consignes de reprise et les limites connues](docs/REPRISE_DEPLOIEMENT.md), notamment pour préserver l'application Suivi PENA existante.

## Utilisation

Voir [le mode d'emploi](LISEZ-MOI.txt) et [l'état d'avancement](docs/ETAT_AVANCEMENT.md).
Les brouillons sont sauvegardés localement dans le navigateur, sans synchronisation entre appareils.
