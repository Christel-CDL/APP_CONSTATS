# État d'avancement — pause du 22 septembre 2026

## Périmètre validé

La première version doit être un outil de **collecte de terrain**, utilisable
sur iPad et sur smartphone Android Samsung Galaxy S24. Les fonctions d'analyse
expertale détaillée, d'historique et de consultation documentaire sont différées.

Le parcours retenu est :

1. choisir le dossier de rattachement ;
2. créer une vue générale, un désordre ou un autre sujet ;
3. prendre des photos dans l'ordre de la visite ;
4. associer chaque photo à un sujet, sans perdre son numéro chronologique ;
5. ajouter une description, un commentaire, une note manuscrite ou une note
   audio ;
6. consigner les suites à donner ;
7. produire un reportage photographique commenté au format Word.

## Prototype enregistré

Le prototype actuel comprend :

- un parcours en quatre étapes : dossier, collecte, actions et synthèse ;
- la prise ou l'import de photos et leur numérotation continue ;
- le classement libre par sujet et le retour sur un sujet antérieur ;
- la demande de géolocalisation depuis le navigateur ;
- un espace quadrillé pour écrire au doigt ou au stylet ;
- l'enregistrement d'une note vocale ;
- les descriptions et commentaires associés à chaque photo ;
- les actions de type tâche, e-mail, calendrier ou demande de pièce ;
- une prévisualisation A4 portrait et un premier export Word modifiable ;
- une sauvegarde locale de démonstration dans le navigateur.

## Appareils et connectivité

- **iPad** : Safari, appareil photo, microphone, tactile et Apple Pencil.
- **Samsung Galaxy S24** : Chrome, appareil photo, microphone et GPS du mobile.
- **iPad sans puce cellulaire** : le partage de connexion du téléphone fournit
  l'accès réseau, mais ne garantit pas que l'iPad recevra la position GPS précise
  du téléphone. La position peut provenir du Wi-Fi et être moins précise.
- **Mode recommandé en visite** : utiliser l'appareil le plus pratique pour les
  photos ; lorsque la précision GPS est essentielle, effectuer la collecte sur
  le S24 ou permettre ultérieurement au S24 de transmettre sa position à la
  session ouverte sur l'iPad.
- **Déploiement** : HTTPS obligatoire pour les autorisations de géolocalisation
  et de microphone dans les navigateurs mobiles.

## Architecture cible envisagée

- listes SharePoint pour les dossiers, visites, sujets, photos et actions ;
- bibliothèque SharePoint pour les photos originales et annotées, les audios et
  les rapports Word ;
- n8n pour la transcription, la création d'e-mails, d'événements et de tâches ;
- fonctionnement hors connexion à prévoir avant une utilisation réelle sur le
  terrain, avec synchronisation différée dès que le réseau revient.

## Prochain lot au redémarrage

1. tester réellement le parcours sur Safari iPad et Chrome Android ;
2. permettre de dessiner directement sur une photo, en plus de la feuille
   quadrillée ;
3. fiabiliser la sauvegarde hors connexion des photos et audios avec IndexedDB ;
4. enregistrer la position de chaque photo au moment exact de sa prise ;
5. afficher une vraie carte avec des marqueurs numérotés ;
6. produire un véritable fichier `.docx` en Arial 12, A4 portrait, avec quatre
   photos maximum par page ;
7. préparer la synchronisation SharePoint et les automatisations n8n ;
8. soumettre un premier exemple de rapport pour validation métier.

## Hors périmètre pour l'instant

- historique et comparaison de visites ;
- consultation des plans et pièces du dossier ;
- analyse des causes et origines ;
- travaux de réparation et travaux déjà réalisés ;
- responsabilités et qualification décennale ;
- insertion directe dans une note expertale ou un rapport principal.

## Reprise du 23 septembre 2026 — annotations photographiques

- Bouton « Annoter la photo » dans la collecte : couleur et épaisseur réglables, doigt, souris ou stylet.
- Original conservé ; version annotée affichée dans la collecte et le rapport.
- Réouverture des annotations et notes manuscrites existantes ; effacement et fermeture sans enregistrer.
- Proportions conservées pour les photos en portrait et paysage.
- La sauvegarde reste celle du prototype (localStorage) : IndexedDB et persistance audio restent à réaliser.
- Tests sur iPad et Samsung réels encore à effectuer.

## Retours terrain — 23 septembre 2026

- Plusieurs photos par sujet, sans limite de cinq ; sujets nommables, compteurs et rattachement explicite. Tous les sujets alimentent le même rapport.
- Caméra par getUserMedia avec solution de repli native sur mobile, import multiple séparé. Autorisations et matériel à valider sur appareils réels.
- Réduction des nouvelles photos en JPEG qualité 0,78, grand côté plafonné à 1 600 pixels. Les fichiers d’origine sur le disque restent intacts.
- Notes manuscrites visibles, audios écoutables et téléchargeables, sauvegarde IndexedDB incluant les audios.
- Transcription pendant la dictée via le navigateur si compatible ; service parfois en ligne. Pas de transcription différée des anciens audios. Échec affiché, texte modifiable.
- Commentaires et transcription modifiables dans la synthèse ; cases d’inclusion pour les textes et la note manuscrite.
- Actions supplémentaires : devis aux parties, action à un tiers ; champ destinataire.
- Carte OpenStreetMap intégrée avec un emplacement sélectionnable à la fois. Les coordonnées de visite ne sont pas présentées comme des positions de capture pour les photos importées.
- Rapport groupé par sujet, deux images par ligne, cadre image 240 × 125 px dans Word. PDF direct avec images 180 × 94 points, deux colonnes et pagination.
- PDF photos seules sans textes privés ni actions ; e-mail préparé par mailto, pièce jointe à ajouter par l’utilisateur.
- Tests navigateur : cinq imports, compression 4000×3000 vers 1600×1200, restauration, rattachement de photos à deux sujets, exclusion des commentaires. Tests PDF : 6 photos, 2 sujets, texte long, exclusion et pagination.
- Version livrée dans le dossier outputs/constat ; le dossier OneDrive original n’a pas été mis à jour pendant ce lot.

### Brouillons de terrain
- Enregistrement explicite et automatique dans IndexedDB ; bibliothèque de brouillons avec dossier, date, sujets et nombre de photos.
- Nouveau constat conserve le précédent ; reprise, correction et compléments possibles.
- Tests navigateur : sauvegarde de 5 photos / 2 sujets, nouveau constat, reprise et rechargement ; les 5 photos sont conservées.
- Stockage local au navigateur et à l’appareil, sans synchronisation distante. Export/import JSON disponible pour une copie complète.
