# Synchronisation data.gouv.fr → Grist

Widget Grist qui importe une ressource tabulaire de [data.gouv.fr](https://www.data.gouv.fr) dans une table, puis la
met à jour en un clic.

Dérivé de [datagouv/grist-plugin-opendata](https://github.com/datagouv/grist-plugin-opendata), réduit à l'import.

## Fonctionnement

- **Import** : recherche d'un jeu de données (ou URL collée), choix d'une table nouvelle ou existante, puis d'une clé de
  rapprochement.
- **Mise à jour (upsert)** : les lignes sont rapprochées par la clé ; seules les lignes réellement modifiées changent.
  - *Clé par colonnes* (SIRET, code INSEE, UAI…) : les lignes modifiées sont mises à jour sur place.
  - *Clé générée* (source sans identifiant) : empreinte du contenu stockée dans `cle_datagouv` ; une ligne modifiée est
    remplacée et les lignes disparues sont supprimées.
- **Horodatage** : la colonne `maj_datagouv` (formule déclenchée `NOW()`) indique la date de création ou de dernière
  modification de chaque ligne. Elle ne surveille que les colonnes de la source.
- **Colonnes ignorées** : leur changement ne compte pas (ni pour `maj_datagouv`, ni pour l'empreinte). Le widget propose
  automatiquement les colonnes de date identiques sur toutes les lignes, comme `date_jeu_donnees`, qui changent à
  chaque publication.
- Les synchronisations sont mémorisées dans le document, dans la table technique `Synchro_datagouv` (visible dans
  « Données brutes », sans page). Elles sont listées sur l'accueil avec un bouton « Mettre à jour », et un badge signale
  quand data.gouv.fr a publié une version plus récente que la dernière mise à jour.
  Supprimer une ligne de `Synchro_datagouv` revient à « oublier » la synchronisation.

Limite : 50 000 lignes par ressource. La source est lue en entier avant toute écriture ; une clé non unique est refusée sans rien modifier. Les colonnes créées sont typées d'après le profil data.gouv.fr (texte par défaut : les codes à zéro initial sont préservés).

## Installation dans Grist

Ajouter une vue *Widget personnalisé*, choisir *URL personnalisée* avec l'adresse du widget déployé, et donner au widget
un **accès complet** au document.

## Développement

```bash
pnpm install
pnpm dev        # http://localhost:8080, à utiliser comme URL de widget dans un Grist local
pnpm lint
pnpm build
```

Variables d'environnement facultatives (voir `.env.dev`) : `VUE_APP_DATAGOUV_IMPORT_URL`,
`VUE_APP_DATAGOUV_TABULAR_API`.

Le workflow `.github/workflows/pages.yml` publie le widget sur GitHub Pages à chaque push sur `main`.

## Code

- `src/sync.ts` : moteur de synchronisation (colonnes, `BulkAddOrUpdateRecord`, suppressions, bilan) et mémorisation dans `Synchro_datagouv`.
- `src/datagouv.ts` : recherche et résolution d'URL sur l'API data.gouv.fr.
- `src/components/HomeView.vue` : accueil et mises à jour.
- `src/components/ImportWizard.vue` : assistant d'import en 3 étapes.
