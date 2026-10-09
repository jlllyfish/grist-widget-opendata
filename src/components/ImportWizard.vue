<template>
  <div>
    <button
      class="fr-btn fr-btn--tertiary fr-btn--sm fr-btn--icon-left fr-icon-arrow-left-line fr-mb-3w"
      :disabled="step === 'running'"
      @click="emit('home')"
    >
      Retour à l'accueil
    </button>

    <div v-if="stepIndex" class="fr-stepper">
      <h2 class="fr-stepper__title">
        {{ STEPS[stepIndex - 1] }}
        <span class="fr-stepper__state">Étape {{ stepIndex }} sur {{ STEPS.length }}</span>
      </h2>
      <div class="fr-stepper__steps" :data-fr-current-step="stepIndex" :data-fr-steps="STEPS.length"></div>
      <p v-if="stepIndex < STEPS.length" class="fr-stepper__details">
        <span class="fr-text--bold">Étape suivante :</span> {{ STEPS[stepIndex] }}
      </p>
    </div>

    <div v-if="error" class="fr-alert fr-alert--error fr-alert--sm fr-mb-3w">
      <p>{{ error }}</p>
    </div>

    <!-- 1. Choix de la ressource -->
    <section v-if="step === 'source'">
      <div class="fr-input-group">
        <label class="fr-label" for="search">Rechercher un jeu de données</label>
        <input id="search" v-model="query" class="fr-input" type="search" placeholder="Ex. : lycées agricoles" @input="onSearchInput" />
      </div>
      <form class="fr-input-group" @submit.prevent="submitUrl">
        <label class="fr-label" for="url">
          ou coller l'adresse d'un jeu de données ou d'une ressource
          <span class="fr-hint-text">https://www.data.gouv.fr/fr/datasets/…</span>
        </label>
        <div class="inline-form">
          <input id="url" v-model="url" class="fr-input" type="url" />
          <button class="fr-btn" type="submit" :disabled="!url.trim() || searching">Afficher</button>
        </div>
      </form>

      <p v-if="searching" class="fr-text--sm">Recherche…</p>
      <p v-else-if="searched && !resources.length" class="fr-text--sm">
        Aucune ressource utilisable trouvée (seuls les fichiers tabulaires analysés par data.gouv.fr sont proposés).
      </p>
      <div v-for="r in resources" :key="r.id" class="fr-tile fr-tile--sm fr-tile--horizontal fr-enlarge-link fr-mb-2w">
        <div class="fr-tile__body">
          <div class="fr-tile__content">
            <h3 class="fr-tile__title">
              <a href="#" @click.prevent="pickResource(r)">{{ r.datasetTitle || r.title }}</a>
            </h3>
            <p class="fr-tile__detail">
              {{ r.title }}<span v-if="r.organization">&nbsp;— {{ r.organization }}</span>
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- 2. Table de destination -->
    <section v-if="step === 'destination'">
      <p class="fr-text--sm">Ressource : <strong>{{ resourceLabel }}</strong></p>
      <fieldset class="fr-fieldset">
        <legend class="fr-fieldset__legend--regular fr-fieldset__legend">Où importer les données ?</legend>
        <div class="fr-fieldset__element">
          <div class="fr-radio-group">
            <input id="dest-new" v-model="destination" type="radio" value="new" />
            <label class="fr-label" for="dest-new">Dans une nouvelle table</label>
          </div>
        </div>
        <div v-if="destination === 'new'" class="fr-fieldset__element fr-input-group indent">
          <label class="fr-label" for="new-table">Nom de la table</label>
          <input id="new-table" v-model="newTableName" class="fr-input" />
        </div>
        <div class="fr-fieldset__element">
          <div class="fr-radio-group">
            <input id="dest-existing" v-model="destination" type="radio" value="existing" :disabled="!tables.length" />
            <label class="fr-label" for="dest-existing">
              Dans une table existante
              <span class="fr-hint-text">Les colonnes et les lignes déjà présentes sont conservées.</span>
            </label>
          </div>
        </div>
        <div v-if="destination === 'existing'" class="fr-fieldset__element fr-select-group indent">
          <label class="fr-label" for="existing-table">Table</label>
          <select id="existing-table" v-model="existingTable" class="fr-select">
            <option value="" disabled>Choisir une table</option>
            <option v-for="t in tables" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
      </fieldset>
      <ul class="fr-btns-group fr-btns-group--inline-sm">
        <li><button class="fr-btn fr-btn--secondary" @click="step = 'source'">Précédent</button></li>
        <li><button class="fr-btn" :disabled="!destinationValid" @click="goToKey">Suivant</button></li>
      </ul>
    </section>

    <!-- 3. Clé de rapprochement -->
    <section v-if="step === 'key'">
      <fieldset class="fr-fieldset">
        <legend class="fr-fieldset__legend--regular fr-fieldset__legend">
          Comment reconnaître une ligne d'une mise à jour à l'autre ?
        </legend>
        <div class="fr-fieldset__element">
          <div class="fr-radio-group">
            <input id="key-columns" v-model="keyMode" type="radio" value="columns" />
            <label class="fr-label" for="key-columns">
              Par une ou plusieurs colonnes de la source
              <span class="fr-hint-text">Les lignes modifiées sont mises à jour sur place.</span>
            </label>
          </div>
        </div>
        <div class="fr-fieldset__element">
          <div class="fr-radio-group">
            <input id="key-hash" v-model="keyMode" type="radio" value="hash" />
            <label class="fr-label" for="key-hash">
              La source n'a pas d'identifiant : générer une clé
              <span class="fr-hint-text">
                Une empreinte du contenu de chaque ligne est stockée dans {{ HASH_COL }}. Une ligne modifiée dans la source
                est remplacée par une nouvelle ligne, et les lignes disparues sont supprimées.
              </span>
            </label>
          </div>
        </div>
      </fieldset>

      <fieldset v-if="keyMode === 'columns'" class="fr-fieldset">
        <legend class="fr-fieldset__legend--regular fr-fieldset__legend">
          Colonne(s) identifiant une ligne de manière unique
          <span class="fr-hint-text">
            Ex. : SIRET, code INSEE, UAI. Cochez plusieurs colonnes si c'est leur combinaison qui est unique.
          </span>
        </legend>
        <div v-for="col in columns" :key="col" class="fr-fieldset__element fr-fieldset__element--inline">
          <div class="fr-checkbox-group fr-checkbox-group--sm">
            <input :id="'col-' + col" v-model="keyColumns" type="checkbox" :value="col" />
            <label class="fr-label" :for="'col-' + col">{{ col }}</label>
          </div>
        </div>
      </fieldset>
      <div v-if="keyMode === 'columns'" class="fr-checkbox-group fr-mb-3w">
        <input id="delete-missing" v-model="deleteMissing" type="checkbox" />
        <label class="fr-label" for="delete-missing">Supprimer les lignes de la table absentes de la source</label>
      </div>

      <ul class="fr-btns-group fr-btns-group--inline-sm">
        <li><button class="fr-btn fr-btn--secondary" @click="step = 'destination'">Précédent</button></li>
        <li>
          <button class="fr-btn" :disabled="keyMode === 'columns' && !keyColumns.length" @click="start">
            Lancer l'import
          </button>
        </li>
      </ul>
    </section>

    <!-- Import en cours -->
    <section v-if="step === 'running'">
      <p>Import en cours dans la table <strong>{{ finalTable || newTableName }}</strong>…</p>
      <progress class="progress" :value="progress.page" :max="progress.total"></progress>
      <p class="fr-text--sm">Page {{ progress.page }} / {{ progress.total }}</p>
    </section>

    <!-- Terminé -->
    <section v-if="step === 'done' && stats">
      <div class="fr-alert fr-alert--success fr-mb-3w">
        <h3 class="fr-alert__title">Données importées dans la table {{ finalTable }}</h3>
        <p>{{ formatStats(stats) }}</p>
      </div>
      <div v-if="configSaved" class="fr-alert fr-alert--info fr-alert--sm fr-mb-3w">
        <p>
          Pour mémoriser cette synchronisation, cliquez sur <strong>Enregistrer</strong> en haut du widget (une seule
          fois). Ensuite, le bouton « Mettre à jour » de l'accueil suffit.
        </p>
      </div>
      <button class="fr-btn fr-btn--icon-left fr-icon-arrow-left-line" @click="emit('home')">Retour à l'accueil</button>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { resolveUrl, searchResources, sourceColumns, type Resource } from '../datagouv';
import {
  HASH_COL,
  createTable,
  formatStats,
  loadSyncs,
  runSync,
  saveSyncIfChanged,
  toGristTableId,
  type KeyMode,
  type SyncConfig,
  type SyncStats,
} from '../sync';

const emit = defineEmits<{ home: [] }>();

type Step = 'source' | 'destination' | 'key' | 'running' | 'done';
const STEPS = ['Choisir les données', 'Choisir la table', 'Rapprocher les lignes'];
const step = ref<Step>('source');
const stepIndex = computed(() => ({ source: 1, destination: 2, key: 3 } as Record<string, number>)[step.value] ?? 0);
const error = ref('');

// --- 1. Ressource ---
const query = ref('');
const url = ref('');
const resources = ref<Resource[]>([]);
const searching = ref(false);
const searched = ref(false);
let searchSeq = 0; // ignore les réponses d'une recherche dépassée
let searchTimer: number | undefined;

function onSearchInput() {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(doSearch, 400);
}

async function doSearch() {
  const q = query.value.trim();
  const seq = ++searchSeq;
  if (!q) {
    resources.value = [];
    searched.value = false;
    return;
  }
  searching.value = true;
  error.value = '';
  try {
    const found = await searchResources(q);
    if (seq === searchSeq) {
      resources.value = found;
      searched.value = true;
    }
  } catch (e: any) {
    if (seq === searchSeq) error.value = e?.message;
  } finally {
    if (seq === searchSeq) searching.value = false;
  }
}

async function submitUrl() {
  const seq = ++searchSeq;
  searching.value = true;
  error.value = '';
  try {
    const found = await resolveUrl(url.value.trim());
    if (seq !== searchSeq) return;
    if (found.length === 1) await pickResource(found[0]);
    else {
      resources.value = found;
      searched.value = true;
    }
  } catch (e: any) {
    error.value = e?.message;
  } finally {
    searching.value = false;
  }
}

const resource = ref<Resource | null>(null);
const columns = ref<string[]>([]);
const resourceLabel = computed(() =>
  resource.value ? [resource.value.datasetTitle, resource.value.title].filter(Boolean).join(' — ') : '',
);

async function pickResource(r: Resource) {
  error.value = '';
  try {
    columns.value = await sourceColumns(r.id);
    resource.value = r;
    keyColumns.value = [];
    newTableName.value = toGristTableId(r.datasetTitle || r.title).slice(0, 40);
    tables.value = await window.grist.docApi.listTables();
    step.value = 'destination';
  } catch (e: any) {
    error.value = e?.message;
  }
}

// --- 2. Table ---
const destination = ref<'new' | 'existing'>('new');
const newTableName = ref('');
const tables = ref<string[]>([]);
const existingTable = ref('');
const destinationValid = computed(() =>
  destination.value === 'new' ? newTableName.value.trim() !== '' : existingTable.value !== '',
);

async function goToKey() {
  // Table déjà synchronisée avec cette ressource : on reprend ses réglages
  if (destination.value === 'existing') {
    const prev = (await loadSyncs())[existingTable.value];
    if (prev && prev.resourceId === resource.value?.id) {
      keyMode.value = prev.keyMode;
      keyColumns.value = [...prev.keys];
      deleteMissing.value = prev.deleteMissing;
    }
  }
  step.value = 'key';
}

// --- 3. Clé ---
const keyMode = ref<KeyMode>('columns');
const keyColumns = ref<string[]>([]);
const deleteMissing = ref(false);

// --- Import ---
const progress = ref({ page: 0, total: 1 });
const stats = ref<SyncStats | null>(null);
const configSaved = ref(false);
const finalTable = ref('');
let createdTable = ''; // évite de recréer la table si on relance après une erreur
watch(newTableName, () => (createdTable = ''));

async function start() {
  error.value = '';
  progress.value = { page: 0, total: 1 };
  step.value = 'running';
  try {
    let table = existingTable.value;
    if (destination.value === 'new') {
      if (!createdTable) createdTable = await createTable(newTableName.value);
      table = createdTable;
    }
    finalTable.value = table;
    const cfg: SyncConfig = {
      table,
      resourceId: resource.value!.id,
      resourceTitle: resourceLabel.value,
      keyMode: keyMode.value,
      keys: keyMode.value === 'columns' ? [...keyColumns.value] : [],
      deleteMissing: deleteMissing.value,
    };
    stats.value = await runSync(cfg, (page, total) => (progress.value = { page, total }));
    configSaved.value = await saveSyncIfChanged(cfg);
    step.value = 'done';
  } catch (e: any) {
    console.error(e);
    error.value = e?.message || "Erreur pendant l'import.";
    step.value = 'key';
  }
}
</script>

<style scoped>
.inline-form {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.inline-form .fr-input {
  margin-top: 0;
}
.indent {
  padding-left: 2rem;
}
.progress {
  width: 100%;
  height: 0.75rem;
  accent-color: var(--background-action-high-blue-france, #000091);
}
</style>
