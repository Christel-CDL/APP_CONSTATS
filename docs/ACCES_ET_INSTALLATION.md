# Accès, comptes et installation de l'icône

## Principe

- L'application est servie par un petit serveur Node (`server/index.cjs`) placé derrière Traefik.
  Sans session, seuls l'écran de lancement (`demarrer.html`), l'icône et le manifeste sont accessibles ;
  tout le reste renvoie vers la connexion (302) ou refuse l'accès (401). Pages marquées `noindex`,
  `robots.txt` bloquant, en-têtes de sécurité (CSP stricte, `X-Frame-Options`, `Permissions-Policy`).
- **Comptes** : table `Utilisateurs` de la base Airtable CONSTATS (champs `Email`, `Nom`, `Organisation`,
  `Rôle`, `Statut du compte`). Statuts admis : `Actif`, `Invité` (passe à `Actif` à la première connexion) ;
  `Suspendu` coupe l'accès sous 6 heures au plus (vérification périodique).
- **Rôle → profil** : `Expert judiciaire` → expertises judiciaires + constats ; `Expert` → expertises
  privées + constats. Christel LACOME : compte gmail = profil judiciaire ; compte cdl-expertises.com
  (à créer, rôle `Expert`, statut `Invité`) = profil privé.
- **Connexion sans mot de passe** : l'adresse reçoit un code à 6 chiffres et un lien, valables 15 minutes
  et à usage unique. Réponse identique que le compte existe ou non ; 5 essais par code ; limitation
  par adresse IP et par e-mail. Session signée (cookie `HttpOnly`, `Secure`, `SameSite=Lax`) de 90 jours.
- **Plusieurs profils sur un appareil** : chaque connexion ajoute un profil. À chaque lancement de l'icône,
  l'écran propose le profil à ouvrir (ouverture directe s'il n'y en a qu'un). Chaque profil a son propre
  espace de stockage sur l'appareil (dossiers, brouillons, photos).
  Limite : sur un même appareil, cette séparation est organisationnelle (même navigateur) ; elle ne protège
  pas contre une personne qui utilise l'appareil déverrouillé. Verrouillez l'iPad et le téléphone.
- **Constats antérieurs aux comptes** : au premier profil ouvert sur l'appareil, l'application propose de
  les copier dans ce profil (l'original n'est jamais effacé).
- **Hors connexion** : après une première ouverture connectée, l'icône s'ouvre sans réseau sur les profils
  déjà connectés de l'appareil. La connexion d'un nouveau profil exige Internet.
- Aucune donnée de constat ne transite par le serveur ni par Airtable : elles restent sur l'appareil.

## Variables d'environnement (hPanel → projet `app-constats`)

| Variable | Rôle |
|---|---|
| `APP_URL` | Adresse publique, sans `/` final (ex. `https://constats.srv1102696.hstgr.cloud`) |
| `SESSION_SECRET` | 64 caractères aléatoires (terminal du VPS : `openssl rand -hex 32`). Le changer déconnecte tout le monde. |
| `AIRTABLE_TOKEN` | Jeton personnel Airtable : portées `data.records:read` et `data.records:write`, accès limité à la base CONSTATS |
| `AIRTABLE_BASE_ID` | Identifiant de la base CONSTATS (`app…`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | Serveur d'envoi des codes (port 587 + `SMTP_SECURE=false`, ou 465 + `true`) |
| `MAIL_FROM` | Expéditeur, ex. `Constats CDL EXPERT <connexion@expertform.fr>` |

Les secrets ne sont jamais écrits dans le dépôt ni dans le fichier compose.

## Installation de l'icône

1. Ouvrir l'adresse de l'application dans **Safari** (iPad/iPhone) ou **Chrome / Samsung Internet** (Galaxy S24).
2. iPad : **Partager** → **Sur l'écran d'accueil** → **Ajouter**. Samsung : bouton « Installer l'application »
   de l'écran de lancement, ou menu → **Ajouter à l'écran d'accueil**.
3. Ouvrir l'application **depuis l'icône**, puis se connecter : saisir l'adresse, puis le code reçu.
   Sur iPad/iPhone, l'icône a son propre stockage, distinct de Safari : se connecter et travailler depuis
   l'icône, et saisir le code (le lien s'ouvrirait dans Safari).
4. Pour le second profil : « Changer de profil » (menu) → « Ajouter un profil ».

L'application s'ouvre alors en plein écran, sans barre d'adresse. L'adresse web existe toujours (elle ne peut
pas être supprimée), mais elle ne donne accès à rien sans compte autorisé.

## Dossiers synchronisés avec Airtable (table Projets)

- Au lancement (et via « ↻ Actualiser depuis Airtable » dans « Mes dossiers »), l'application récupère les
  dossiers rattachés au compte (champ `Responsable` / lien `Projets` de l'utilisateur), limités aux types du
  profil : `Expertise judiciaire` pour le profil judiciaire, `Expertise amiable` pour le profil privé, et les
  missions de conseil, diagnostic et suivi de chantier pour les deux.
- Un dossier créé ou modifié dans l'application est enregistré dans Airtable (type privé → `Expertise amiable`).
  Hors connexion, il est marqué « En attente d'envoi » et transmis à la synchronisation suivante.
- Expertise judiciaire : le champ `Client / Juridiction` n'est jamais lu, transmis ni écrit par le serveur.
- Supprimer un dossier dans l'application le retire de l'appareil seulement ; il reste dans Airtable.
- Le jeton Airtable doit avoir `data.records:read` et `data.records:write` sur la base CONSTATS.

## Fiche de suivi des constats (table Constats)

- Chaque constat a une fiche dans la table `Constats`, retrouvée par `Identifiant appli` (identifiant du constat
  sur l'appareil) : `Titre`, `Date de visite`, `Statut`, `Projet`, `Auteur`, et une `Synthèse` limitée au nombre de
  photos et au nom du dernier fichier exporté.
- Statut `Finalisé` dès qu'un rapport (HTML, Word, PDF) est exporté ; `Rapport envoyé` quand le constat est terminé
  (« ✓ Terminer ce constat ») après un export. Hors connexion, la fiche est envoyée au retour du réseau.
- Photos, commentaires, feuille de présence et rapports ne sont **jamais** envoyés à Airtable : ils restent sur
  l'appareil et dans les fichiers exportés (OneDrive).
- Expertise judiciaire : titre limité à la référence OPALEXE et à la date ; `Lieu visité` toujours vide (contrôlé
  aussi par le serveur d'après le type du dossier lié).
- Nom de table modifiable par la variable facultative `AIRTABLE_CONSTATS_TABLE` (défaut `Constats`).
