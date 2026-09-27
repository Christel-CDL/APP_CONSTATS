# Modèles de rapport CDL EXPERT — principe de fonctionnement

Le bouton « Rapport HTML (modèle CDL) » de l'étape 4 produit un fichier HTML autonome
(logo et photos intégrés, aucune police ni ressource externe) selon le type de constat.

| Type de constat | Modèle | Couleur | Données client |
|---|---|---|---|
| Expertise judiciaire (`ej`) | En-tête navy, bloc nominatif ambre, note expertale rouge | `#1A3A5C` | **Jamais saisies dans l'application** |
| Expertise privée (`ep`) | Bandeau confidentiel, mission, conclusions, signature | `#6B8C3E` | Saisies par l'expert (sa responsabilité) |
| Constat autre (`autre`) | Structure EJ sans bloc nominatif | `#B07A10` | — |

Le type est repris du dossier (« Expertise judiciaire » → `ej`, « Expertise privée » ou
l'ancien libellé « Expertise amiable » → `ep`, autres → `autre`) et reste modifiable à l'étape 1.

Nom du fichier : `[RÉFÉRENCE]_CONSTAT_[AAAA-MM-JJ].html` (date de visite).

## Expertise judiciaire — règles RGPD appliquées par l'application

1. Le champ « Client / donneur d'ordre » d'un dossier EJ est désactivé et vidé à l'enregistrement ;
   une valeur héritée d'une version antérieure est ignorée à la lecture.
2. Un constat EJ ne conserve ni donneur d'ordre ni adresse du donneur d'ordre (brouillon, sauvegarde JSON).
3. La référence attendue est la référence OPALEXE (`EJ26-1402`) ; un autre format déclenche un avertissement
   à l'étape 1 et une confirmation à l'export. Elle sert de clé pour compléter le rapport.
4. Le rapport contient un bloc `data-nominatif="true"` **vide** : `tribunal`, `num_expertise_rg`,
   `intitule_dossier`, `expert`, ainsi que `num_expertise` dans l'en-tête. Ces champs sont complétés
   après génération, hors application, à partir du tableau de suivi.
5. Option « Masquer le bloc nominatif » : le bloc reste présent et vide dans le fichier, avec
   `hidden` et `data-masque="true"` (retirer ces deux attributs pour l'afficher).
6. Présents : saisir les qualités (Expert désigné, Demandeur, Conseil du défendeur…), pas les noms.

Les textes libres (descriptions, commentaires, dictées, note expertale) ne sont pas analysés :
l'expert veille à n'y porter aucun nom de partie.

## Hooks d'injection (`data-*`)

Les noms suivent les modèles v3 (`legende`, `commentaire`, `section_titre`).

| Portée | `data-field` | Source |
|---|---|---|
| En-tête | `type_badge`, `titre_rapport`, `ref_cdl` | type, `caseReference` |
| Dossier | `type_constat`, `date_visite` (JJ/MM/AAAA), `adresse_site`, `objet` | type, `visitDate`, `siteAddress`, `caseName` |
| EJ nominatif | `tribunal`, `num_expertise_rg`, `intitule_dossier`, `expert`, `num_expertise` | vides |
| EP | `client_nom`, `client_adresse`, `expert`, `mission_detail`, `conclusions` | `clientName`, `clientAddress`, `missionDetail`, `conclusions` |
| Visite (`data-visit-index="1"`) | `visit_date`, `presents` (`<li>`), `expert_note` | `visitDate`, `presents`, `expertNote` |
| Section (`data-section-index`, à partir de 1) | `section_titre`, `synthese_section`, `note_expertale` | `subjects[]` ; boîtes vides à compléter |
| Photo (`data-photo-index` = numéro chronologique) | `photo_img`, `legende`, `commentaire`, `transcript`, `note_manuscrite` | `annotatedSrc` prioritaire sur `src`, `description`, `comment`, `transcript`, `drawing` |
| Action (`data-action-index`, à partir de 1) | `action_type`, `action_text`, `action_recipient`, `action_date` | `actions[]` (lignes vides ignorées) |
| Visite | `position` | `48°45'36" N / 2°30'36" E (précision ±187 m)` |
| Pied | `ref_pied`, `date_generation` | référence seule ; date du jour |

Les éléments photo portent `data-include="description|comment|transcript|drawing"`. Une rubrique
décochée est rendue **vide** et `hidden` : le texte exclu n'est pas écrit dans le fichier.

## Hors périmètre de ce lot

Synchronisation Airtable, dépôt automatique dans OneDrive et comptes multi-utilisateurs
nécessitent un service côté serveur (jetons d'API non exposés au navigateur) : ils restent à réaliser.

## Procès-verbaux d'expertise privée (réception, levée des réserves)

En expertise privée, l'étape 1 propose « Document à produire » : rapport de constats, PV de réception
ou PV de levée des réserves. Le PV est enregistré avec le constat (`pv` dans la sauvegarde) ; il est
effacé si le constat quitte l'expertise privée, pour ne jamais conserver de données de parties en EJ.

Structure reprise des PV de chantier : parties (entreprise, maître d'ouvrage), références contractuelles,
ouvrage et prestations, adresse, date de visite, présents ; 1) réception avec / sans réserves et date
d'effet (point de départ des garanties légales, art. 1792-6 C. civ.), période de travaux, déclarations
OUI / NON ; 2) tableau des réserves (N°, localisation, désordre, délai ou date de levée, observations,
n° de photos) ; 3) documents remis (DOE) ; 4) règlement du solde ; signatures ; annexe photographique.

- « Créer une réserve par photo non citée » : localisation = sujet, désordre = description de la photo.
- PV de levée : « Reprendre ce PV de réception » copie parties, références et réserves d'un constat
  enregistré (le même dossier en premier) ; chaque réserve est ensuite constatée « Levée » (date du jour
  de visite par défaut) ou « Non levée ». Le PV affiche le bilan des réserves levées.
- Exports : HTML (même charte, imprimable A4) et Word modifiable. Fichiers
  `[RÉF]_PV-RECEPTION_[date].html|.docx` et `[RÉF]_PV-LEVEE-RESERVES_[date].html|.docx`.

Hooks : `entreprise_nom`, `entreprise_adresse`, `entreprise_rcs`, `entreprise_representant`, `moa_nom`,
`moa_adresse`, `references`, `ouvrage`, `reception_choix`, `reception_date`, `declarations`,
lignes `data-reserve-index` (`reserve_localisation`, `reserve_desordre`, `reserve_delai` ou `reserve_levee`,
`reserve_observations`, `reserve_photos`), `doe`, `montant_total`, `montant_solde`, `signataire_moa`,
`signataire_entreprise`.

## Constat simple, signatures et protection avant effacement (27 septembre)

- **Constat simple avec suites à donner** (expertise privée, « Document à produire ») : en-tête CDL, identification,
  présents, avis de l'expert, photos, tableau « Suites à donner demandées » (type, description, destinataire,
  échéance) ; sans mission ni conclusions. Fichier `[RÉF]_CONSTAT-SIMPLE_[date].html`.
- **Signatures au doigt ou au stylet** : maître d'ouvrage et entreprise dans les PV ; signature de l'expert
  sur tous les documents, affichée seulement si la case « J'appose ma signature d'expert » est cochée.
  Chaque signature est datée et associée à une empreinte du contenu du PV : si le PV est modifié ensuite,
  l'export est bloqué jusqu'à une nouvelle signature (ou l'effacement de l'ancienne). Il s'agit d'une
  signature électronique simple (art. 1367 C. civ. ; règlement eIDAS n° 910/2014, art. 25) : elle ne peut
  être écartée au seul motif de sa forme électronique, mais sa force probante reste inférieure à celle d'une
  signature avancée ou qualifiée ; pour un enjeu contentieux, faire aussi signer l'exemplaire imprimé.
- **Avant tout effacement de données de parties** (passage d'un constat hors expertise privée, ou en
  expertise judiciaire) : si ces données n'ont pas été exportées depuis leur dernière modification
  (export HTML/Word du document, ou sauvegarde JSON), l'application télécharge d'abord une sauvegarde
  complète du constat, puis demande confirmation après vérification du fichier.
