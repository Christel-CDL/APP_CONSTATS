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

## Stabilisation du 24 septembre 2026

- Intégration effective du stylo et de la gomme, auparavant non reliés à des boutons présents.
- Préparation des accès au démarrage, réutilisation des pistes médias, suspension explicite et rejet des retours d'autorisation après annulation.
- Position récente à la capture ; absence de position automatique pour les photos importées et le sélecteur natif.
- Dossier, référence et date modifiables et sauvegardés avec le constat.
- Export Word natif .docx incorporant images et textes sélectionnés, A4 et Arial 12.
- Service worker limité au dossier de l'application pour rechargement et exports sans réseau après une première ouverture connectée.
- Protection du brouillon courant en cas d'échec de sauvegarde et avant import d'une autre visite.
- Tests navigateur, cas d'échec et rapports longs ajoutés au dépôt. Détails et limites actuelles dans REPRISE_DEPLOIEMENT.md.

## Retours terrain — 22 octobre 2026 : note vocale

- Constats de test analysés (8 copies Airtable, 27/09 au 16/10) : aucune transcription ni commentaire dicté depuis l'installation en icône, un seul son enregistré ; les descriptions sont saisies au clavier.
- Cause : sur iPad/iPhone, la reconnaissance vocale du navigateur n'est pas disponible dans une application ajoutée à l'écran d'accueil (limite WebKit), alors qu'elle fonctionne dans un onglet Safari.
- Correctif : dans l'application installée sur iPad/iPhone, « Dicter un commentaire » ouvre directement le grand champ, curseur placé, pour dicter avec la touche 🎙 du clavier (le micro de la visite est libéré auparavant). Partout ailleurs, une dictée refusée ou sans texte reconnu bascule aussi vers ce champ.
- Transcription différée des enregistrements sonores : toujours non intégrée (choix du moteur et de l'hébergement à faire, données à garder en Europe).

## Lien avec le tableau de suivi des expertises — 22 octobre 2026

- Table Projets d'Airtable : nouveau champ « Code Constats » ; la formule « Nom du projet » l'affiche lorsqu'il est rempli.
- Import initial depuis le tableau du 22/10/2026 : 20 dossiers (18 en cours, 1 rapport déposé → Clos, 1 archivé), dont 3 existants mis à jour. Les 3 dossiers « À attribuer » sont ignorés tant que leur n° n'est pas connu.
- Serveur : le nom saisi pour un dossier est écrit dans « Code Constats » (« Nom du projet » étant une formule, son écriture était refusée par Airtable) ; sans référence, le n° est déduit du code.
- Mise à jour automatique : réalisée le 24/10/2026 (lecture du tableau par le serveur, voir ACCES_ET_INSTALLATION.md).
- 24/10/2026 : à la demande de Christel, seules les expertises « En cours » restent dans Airtable ; les autres (en attente, rapport déposé, archivées) en sont retirées à chaque lecture du tableau, et les 2 dossiers terminés importés le 22/10 ont été supprimés.

## Retours d'usage — 24 octobre 2026 : brouillons, accueil, rapports

- Suppression d’un constat possible pour tout brouillon (en cours ou terminé), depuis « Mes brouillons » ou depuis le constat ouvert (« Supprimer ce constat », en bas de page). Elle vaut pour tous les appareils : le constat est effacé du serveur et de sa copie Airtable, puis des autres appareils à leur ouverture suivante (sauf modification non envoyée sur l'un d'eux, qui le recrée). Hors réseau, la suppression est transmise au retour de la connexion.
- Accueil : indicateur « Actions à suivre » et encadré « Échéances » retirés (les suites à donner servent au compte rendu et à l'assistant) ; « Reprendre le constat actuel » en tête ; un seul bouton « Nouveau constat » (barre du haut).
- « Sauvegarder la visite dans un fichier » devient « Copie de secours de ce constat », en bas du constat ; « Ouvrir une sauvegarde » devient « Importer une copie de secours », dans « Mes brouillons ».
- Onglet « Rapports » : liste des constats avec le dernier fichier enregistré et un accès direct à la synthèse (étape 4) pour produire HTML, Word ou PDF.

## Sortie d'Airtable — étape 1 (24 octobre 2026) : dossiers lus directement dans les tableaux de suivi

- Tableaux créés dans OneDrive : `EXPERTISES/Expertises 2026/Tableau_suivi_expertises_privees.xlsx` (4 dossiers 2026 pré-remplis) et `DEV-CONSULT/Tableau_suivi_missions_conseil.xlsx` (21 dossiers clients pré-remplis), codes proposés, statuts à renseigner par Christel.
- Le serveur compose la liste des dossiers à partir des tableaux (profil judiciaire : tableau EJ ; profil expertise privée : tableaux EP et conseil), sans la table Projets d'Airtable. Dossiers existants reconnus par leur référence (constats toujours rattachés). Dossiers créés dans l'application conservés sur le serveur.
- Restent sur Airtable : comptes de connexion (étape 3) et copie des constats (remplacée à l'étape 2 par le rangement des rapports et des photos dans OneDrive, droit d'écriture à accorder).

## Sortie d'Airtable — étape 2 (24 octobre 2026) : rangement dans OneDrive

- À la clôture d'un constat, le rapport HTML (modèle CDL ou PV) et les photos sont rangés dans le dossier OneDrive de la mission (`CONSTATS/AAAA-MM-JJ/`, photos dans `Photos/`). Droit délégué `Files.ReadWrite` ajouté dans Microsoft Entra par Christel ; chaque profil doit reconnecter OneDrive une fois.
- Dossier terminé ou retiré du tableau : ses constats rangés sont effacés du serveur et des appareils ; les autres sont signalés. Suppression de dossier retirée de l'application.
- La copie des constats dans Airtable reste active jusqu'à l'étape 3 (comptes sur le serveur, arrêt d'Airtable).
- Un constat terminé et rangé dans OneDrive quitte « Mes brouillons » ; il reste dans son dossier (« Rouvrir pour compléter », tant que le dossier est en cours) et dans l'onglet « Rapports ». Rouvert puis terminé à nouveau, il est rangé de nouveau au même endroit.
- 24/10/2026 (retours) : sous-dossier de rangement nommé `CONSTATS` (majuscules) dans chaque dossier de mission ; dossier retrouvé même quand le lien « Ouvrir » du tableau est relatif ou codé (`file:///…%20…`), sinon par le n° d'expertise dans le dossier du tableau ; bouton « Ranger dans OneDrive / Réessayer le rangement » pour un constat terminé non rangé (motif affiché) ; plus de demande caméra / micro / position après la clôture ; titres complets (code) dans « Sur vos autres appareils ».
- 24/10/2026 (2e essai réel) : dossiers d'expertise rangés par tribunal (« Dossiers en cours/TJ …/<dossier> ») et nommés sans n° : recherche de secours sur deux niveaux, par n° ou par le nom court du code (correspondance unique) ; rapport reconstruit au moment du rangement (plus stocké sur l'appareil) ; jamais « rangé » sans rapport ; destination affichée sur la carte ; journal du serveur « Rangement OneDrive … » (référence, méthode, nombre de fichiers, refus) ; envoi au serveur non repoussé après la clôture.
