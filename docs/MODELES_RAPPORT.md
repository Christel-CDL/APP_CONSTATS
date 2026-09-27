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
