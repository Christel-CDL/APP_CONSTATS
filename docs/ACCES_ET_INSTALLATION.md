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
| `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | Facultatif : lecture du tableau de suivi des expertises dans OneDrive (voir plus bas). Sans elles, l'application fonctionne sans cette lecture. |
| `TABLEAU_SUIVI_CHEMIN` | Facultatif : chemin du tableau dans OneDrive, par défaut `EXPERT JUDICIAIRE/DOSSIERS/Dossiers en cours/Tableau_suivi_expertises.xlsx` (feuille `Suivi expertises`, modifiable par `TABLEAU_SUIVI_FEUILLE`) |

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

## Tableau de suivi des expertises judiciaires (OneDrive → dossiers)

Le tableau Excel reste la référence. Sa colonne « Code Constats » (`EJ24-358_NOM`) devient le nom du dossier
(champ `Code Constats` de la table Projets) ; le n° (`EJ24-358`) devient la `Référence` ; le statut est repris
(« Rapport déposé » → `Clos`). Les lignes sans code complet (« À attribuer ») sont ignorées. Rien d'autre n'est
lu dans le tableau : ni parties, ni juridiction, ni n° RG, ni observations.

- **Quand ?** À chaque ouverture du profil judiciaire (au plus une fois toutes les 2 minutes, et sans relecture
  si le fichier n'a pas changé), et sur demande avec « 🔎 Rechercher dans le tableau de suivi » (étape 1 d'un
  constat et « Mes dossiers »). Un dossier n'est jamais supprimé par cette lecture.
- **Accès à OneDrive.** Le serveur lit le fichier avec le compte Microsoft de l'expert, par Microsoft Graph,
  avec le seul droit délégué `Files.Read` (lecture des fichiers de ce compte ; aucun droit d'écriture). La
  première fois, l'application affiche « Connecter OneDrive » : se connecter au compte CDL EXPERTISES et
  accepter. Le jeton de renouvellement est chiffré sur le serveur (volume `/data`) ; s'il est révoqué ou expiré
  (90 jours sans utilisation), le lien « Connecter OneDrive » réapparaît.

### Mise en place (une fois, compte administrateur Microsoft 365)

1. Centre d'administration Microsoft Entra → **Applications** → **Inscriptions d'applications** → **Nouvelle inscription**.
   Nom : `Constats CDL EXPERT` ; types de comptes : **comptes de cet annuaire d'organisation uniquement** ;
   URI de redirection : plateforme **Web**, `https://app.expertform.fr/api/microsoft/retour` (adresse de `APP_URL`
   suivie de `/api/microsoft/retour`).
2. Page **Vue d'ensemble** : copier l'**ID d'application (client)** → `MS_CLIENT_ID` et l'**ID de l'annuaire
   (locataire)** → `MS_TENANT_ID`.
3. **Certificats et secrets** → **Nouveau secret client** (24 mois au plus) : copier la **valeur** → `MS_CLIENT_SECRET`.
   Noter la date d'expiration : le secret est à renouveler avant cette date.
4. **Autorisations d'API** → **Microsoft Graph** → **Autorisations déléguées** : `Files.Read` et `offline_access`
   (`User.Read` est présent par défaut).
5. hPanel → projet `app-constats` : renseigner les trois variables, puis **Déployer**.
6. Dans l'application, profil judiciaire : « Connecter OneDrive », puis « 🔎 Rechercher dans le tableau de suivi ».

## Sauvegarde des constats et passage d'un appareil à l'autre

- Chaque constat est sauvegardé sur le serveur (VPS) quelques secondes après chaque modification ; hors réseau, il
  l'est au retour de la connexion. Les photos, sons, notes manuscrites et signatures sont stockés sur le VPS
  (volume Docker `constats-data`, monté sur `/data`), envoyés une seule fois (empreinte SHA-256).
- Sur un autre appareil connecté au même profil : « Mes brouillons › Sur vos autres appareils » → « Récupérer sur
  cet appareil ». Au lancement, les constats déjà présents sont mis à jour s'ils ont été modifiés ailleurs.
- Modification du même constat sur deux appareils : l'application le signale et demande quelle version garder.
- **Volume obligatoire** : sans le volume `constats-data`, les constats et photos du serveur seraient perdus à chaque
  redéploiement. Le journal de démarrage l'indique (`DATA_DIR : … aucun volume monté`).

## Copie dans Airtable (table Constats)

- Une fiche par constat, retrouvée par `Identifiant appli` et rattachée au dossier (`Projet`) par son lien, ou à
  défaut par la `Référence` (n° de l'expertise, référence OPALEXE en expertise judiciaire).
- Champs : `Titre`, `Référence`, `Date de visite`, `Lieu visité` (adresse du site), `Latitude`/`Longitude`, `Statut`
  (`Brouillon`, `Finalisé` après un rapport enregistré, `Rapport envoyé` après « Terminer ce constat »), `Synthèse`
  (texte lisible : sujets, commentaires, suites à donner), `Données appli (JSON)` (copie complète du constat, sans
  les images), `Mis à jour le`, `Auteur`.
- Copie différée et regroupée (10 minutes après la dernière modification, quelques secondes après un changement de
  statut) : le forfait Airtable limite le nombre d'appels API par mois. L'état de la copie est affiché dans
  « Mes brouillons » (copié, en attente, erreur).
- Expertise judiciaire : ni donneur d'ordre ni feuille de présence (noms) ne sont envoyés ; l'adresse du site l'est.
- Les photos ne sont jamais envoyées à Airtable : elles restent sur le VPS et dans les rapports.
- Variables facultatives : `AIRTABLE_CONSTATS_TABLE` (défaut `Constats`), `MIRROR_DELAY_MS`, `DATA_DIR` (défaut `/data`).
