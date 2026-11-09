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
        <legend class="fr-fieldset__legend--regular fr-fieldset__legend">
          Où importer les données ?
          <span v-if="edit" class="fr-hint-text">
            Table actuelle : {{ edit.table }}. Si vous en choisissez une autre, {{ edit.table }} est conservée telle quelle
            mais ne sera plus mise à jour.
          </span>
        </legend>
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
        <li><button class="fr-btn fr-btn--secondary" :disabled="isEdit" @click="step = 'source'">Précédent</button></li>
        <li><button class="fr-btn" :disabled="!destinationValid" @click="goToFilter">Suivant</button></li>
      </ul>
    </section>

    <!-- 3. Filtre -->
    <section v-if="step === 'filter'">
      <p class="fr-text--sm">
        Ressource : <strong>{{ resourceLabel }}</strong><br />
        <span v-if="totalRows !== null">{{ totalRows.toLocaleString('fr-FR') }} lignes sur data.gouv.fr</span>
      </p>
      <fieldset class="fr-fieldset">
        <legend class="fr-fieldset__legend--regular fr-fieldset__legend">
          Importer seulement une partie des lignes (facultatif)
          <span class="fr-hint-text">
            Le filtre est appliqué par data.gouv.fr et conservé pour les mises à jour suivantes.
          </span>
        </legend>
        <div class="fr-fieldset__element">
          <div class="fr-radio-group">
            <input id="filter-none" v-model="filterOn" type="radio" :value="false" />
            <label class="fr-label" for="filter-none">Toutes les lignes</label>
          </div>
        </div>
        <div class="fr-fieldset__element">
          <div class="fr-radio-group">
            <input id="filter-on" v-model="filterOn" type="radio" :value="true" />
            <label class="fr-label" for="filter-on">Seulement les lignes où…</label>
          </div>
        </div>
        <div v-if="filterOn" class="fr-fieldset__element indent filter-grid">
          <div class="fr-select-group">
            <label class="fr-label" for="filter-col">Colonne</label>
            <select id="filter-col" v-model="filterCol" class="fr-select">
              <option value="" disabled>Choisir une colonne</option>
              <option v-for="c in columns" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
          <div class="fr-select-group">
            <label class="fr-label" for="filter-op">Condition</label>
            <select id="filter-op" v-model="filterOp" class="fr-select">
              <option v-for="(label, op) in FILTER_OPS" :key="op" :value="op">{{ label }}</option>
            </select>
          </div>
          <div class="fr-input-group">
            <label class="fr-label" for="filter-value">
              Valeur
              <span v-if="filterOp === 'in'" class="fr-hint-text">Ex. : 76;75</span>
            </label>
            <input id="filter-value" v-model="filterValue" class="fr-input" list="filter-values" autocomplete="off" />
            <datalist id="filter-values">
              <option v-for="v in sampleValues[filterCol] ?? []" :key="v" :value="v"></option>
            </datalist>
          </div>
        </div>
        <p v-if="filterOn && currentFilter" class="fr-text--sm fr-mb-0 indent" :class="{ 'fr-error-text': filteredRows === 0 }">
          <template v-if="counting">Comptage…</template>
          <template v-else-if="filteredRows !== null">
            → {{ filteredRows.toLocaleString('fr-FR') }} ligne(s) correspondent au filtre
          </template>
        </p>
      </fieldset>
      <ul class="fr-btns-group fr-btns-group--inline-sm">
        <li><button class="fr-btn fr-btn--secondary" @click="step = 'destination'">Précédent</button></li>
        <li>
          <button class="fr-btn" :disabled="filterOn && (!currentFilter || filteredRows === 0)" @click="step = 'key'">
            Suivant
          </button>
        </li>
      </ul>
    </section>

    <!-- 4. Clé de rapprochement -->
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
        <div v-for="col in keyCandidates" :key="col" class="fr-fieldset__element fr-fieldset__element--inline">
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

      <fieldset class="fr-fieldset">
        <legend class="fr-fieldset__legend--regular fr-fieldset__legend">
          Colonnes à ignorer pour détecter les changements
          <span class="fr-hint-text">
            Elles sont importées, mais leur changement ne compte pas : la ligne garde sa date dans {{ MAJ_COL }}. Utile
            pour une date de publication qui change sur toutes les lignes à chaque mise à jour.
            <template v-if="suggestedIgnore.length">Proposé automatiquement : {{ suggestedIgnore.join(', ') }}.</template>
          </span>
        </legend>
        <div v-for="col in columns" :key="'ign-' + col" class="fr-fieldset__element fr-fieldset__element--inline">
          <div class="fr-checkbox-group fr-checkbox-group--sm">
            <input :id="'ign-' + col" v-model="ignoredColumns" type="checkbox" :value="col" :disabled="keyMode === 'columns' && keyColumns.includes(col)" />
            <label class="fr-label" :for="'ign-' + col">{{ col }}</label>
          </div>
        </div>
      </fieldset>

      <ul class="fr-btns-group fr-btns-group--inline-sm">
        <li><button class="fr-btn fr-btn--secondary" @click="step = 'filter'">Précédent</button></li>
        <li>
          <button class="fr-btn" :disabled="keyMode === 'columns' && !keyColumns.length" @click="start">
            {{ isEdit ? 'Enregistrer et mettre à jour' : "Lancer l'import" }}
          </button>
        </li>
      </ul>
    </section>

    <!-- Import en cours -->
    <section v-if="step === 'running'">
      <p>Import en cours dans la table <strong>{{ finalTable || newTableName }}</strong>…</p>
      <progress class="progress" :value="progress.done" :max="progress.total"></progress>
      <p class="fr-text--sm">
        <template v-if="progress.phase === 'lecture'">Lecture des données data.gouv.fr : page {{ progress.done }} / {{ progress.total }}</template>
        <template v-else>Écriture dans Grist : {{ progress.done.toLocaleString('fr-FR') }} / {{ progress.total.toLocaleString('fr-FR') }} lignes</template>
      </p>
    </section>

    <!-- Terminé -->
    <section v-if="step === 'done' && stats">
      <div class="fr-alert fr-alert--success fr-mb-3w">
        <h3 class="fr-alert__title">Données importées dans la table {{ finalTable }}</h3>
        <p>{{ formatStats(stats) }}</p>
      </div>
      <p v-if="edit && finalTable !== edit.table" class="fr-text--sm">
        La synchronisation porte désormais sur {{ finalTable }}. L'ancienne table {{ edit.table }} est conservée, sans
        mise à jour : vous pouvez la supprimer si elle ne sert plus.
      </p>
      <p class="fr-text--sm">
        Cette synchronisation est mémorisée dans le document (table {{ STORE_TABLE }}) : vous la retrouverez sur l'accueil
        du widget pour la mettre à jour en un clic.
      </p>
      <button class="fr-btn fr-btn--icon-left fr-icon-arrow-left-line" @click="emit('home')">Retour à l'accueil</button>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { countRows, resolveUrl, searchResources, sourceSample, type Resource } from '../datagouv';
import {
  FILTER_OPS,
  HASH_COL,
  MAJ_COL,
  createTable,
  formatStats,
  loadSyncs,
  runSync,
  saveSync,
  STORE_TABLE,
  toGristTableId,
  type FilterOp,
  type KeyMode,
  type SavedSync,
  type SyncConfig,
  type SyncFilter,
  type SyncStats,
} from '../sync';

const props = defineProps<{ edit?: SavedSync | null }>();
const emit = defineEmits<{ home: [] }>();
const isEdit = computed(() => Boolean(props.edit));

type Step = 'source' | 'destination' | 'filter' | 'key' | 'running' | 'done';
const STEPS = ['Choisir les données', 'Choisir la table', 'Filtrer les lignes', 'Rapprocher les lignes'];
const step = ref<Step>('source');
const stepIndex = computed(
  () => ({ source: 1, destination: 2, filter: 3, key: 4 } as Record<string, number>)[step.value] ?? 0,
);
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
const suggestedIgnore = ref<string[]>([]);
const sourceNames = ref<Record<string, string>>({});
const sampleValues = ref<Record<string, string[]>>({});
const totalRows = ref<number | null>(null);

async function loadSample(resourceId: string) {
  const sample = await sourceSample(resourceId);
  columns.value = sample.columns;
  suggestedIgnore.value = sample.suggestedIgnore;
  sourceNames.value = sample.sourceNames;
  sampleValues.value = sample.values;
  totalRows.value = await countRows(resourceId);
  return sample;
}
const resourceLabel = computed(() =>
  resource.value ? [resource.value.datasetTitle, resource.value.title].filter(Boolean).join(' — ') : '',
);

async function pickResource(r: Resource) {
  error.value = '';
  try {
    const sample = await loadSample(r.id);
    resource.value = r;
    keyColumns.value = [];
    ignoredColumns.value = [...sample.suggestedIgnore];
    filterOn.value = false;
    filterValue.value = '';
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

function applySettings(prev: SavedSync) {
  keyMode.value = prev.keyMode;
  keyColumns.value = [...prev.keys];
  deleteMissing.value = prev.deleteMissing;
  if (prev.ignored?.length) ignoredColumns.value = [...prev.ignored];
  if (prev.filter) {
    filterOn.value = true;
    filterCol.value = Object.keys(sourceNames.value).find((id) => sourceNames.value[id] === prev.filter!.column) ?? '';
    filterOp.value = prev.filter.op;
    filterValue.value = prev.filter.value;
  }
}

async function goToFilter() {
  error.value = '';
  if (destination.value === 'existing') {
    const prev = (await loadSyncs())[existingTable.value];
    const other = prev && prev.rowId !== props.edit?.rowId;
    // Une table ne peut porter qu'une synchronisation : sinon les deux se mélangeraient
    if (other && (isEdit.value || prev.resourceId !== resource.value?.id)) {
      error.value =
        `La table ${existingTable.value} est déjà synchronisée avec « ${prev.resourceTitle || prev.resourceId} ». ` +
        'Choisissez une autre table ou une nouvelle table.';
      return;
    }
    // Table déjà synchronisée avec cette ressource : on reprend ses réglages
    if (other) applySettings(prev);
  }
  step.value = 'filter';
}

// --- 3. Filtre ---
const filterOn = ref(false);
const filterCol = ref('');
const filterOp = ref<FilterOp>('exact');
const filterValue = ref('');
const filteredRows = ref<number | null>(null);
const counting = ref(false);
const currentFilter = computed<SyncFilter | null>(() =>
  filterOn.value && filterCol.value && filterValue.value.trim()
    ? { column: sourceNames.value[filterCol.value] ?? filterCol.value, op: filterOp.value, value: filterValue.value.trim() }
    : null,
);
let countTimer: number | undefined;
watch(currentFilter, (f) => {
  window.clearTimeout(countTimer);
  filteredRows.value = null;
  if (!f || !resource.value) return;
  counting.value = true;
  countTimer = window.setTimeout(async () => {
    const n = await countRows(resource.value!.id, f);
    if (JSON.stringify(f) === JSON.stringify(currentFilter.value)) {
      filteredRows.value = n;
      counting.value = false;
    }
  }, 400);
});

// Mode « Modifier » : on ouvre l'étape « table » de la synchronisation existante, réglages repris
onMounted(async () => {
  const e = props.edit;
  if (!e) return;
  try {
    await loadSample(e.resourceId);
    resource.value = { id: e.resourceId, title: e.resourceTitle || e.resourceId, datasetTitle: '' };
    destination.value = 'existing';
    existingTable.value = e.table;
    newTableName.value = toGristTableId(`${e.table}_bis`).slice(0, 40);
    tables.value = await window.grist.docApi.listTables();
    applySettings(e);
    step.value = 'destination';
  } catch (err: any) {
    error.value = err?.message;
  }
});

// --- 3. Clé ---
const keyMode = ref<KeyMode>('columns');
const keyColumns = ref<string[]>([]);
const deleteMissing = ref(false);
const ignoredColumns = ref<string[]>([]);
// Une colonne ignorée ne peut pas servir de clé
const keyCandidates = computed(() => columns.value.filter((c) => !ignoredColumns.value.includes(c)));

// --- Import ---
const progress = ref<{ phase: 'lecture' | 'écriture'; done: number; total: number }>({ phase: 'lecture', done: 0, total: 1 });
const stats = ref<SyncStats | null>(null);
const finalTable = ref('');
let createdTable = ''; // évite de recréer la table si on relance après une erreur
watch(newTableName, () => (createdTable = ''));

async function start() {
  error.value = '';
  progress.value = { phase: 'lecture', done: 0, total: 1 };
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
      ignored: ignoredColumns.value.filter((c) => keyMode.value === 'hash' || !keyColumns.value.includes(c)),
      filter: currentFilter.value,
    };
    stats.value = await runSync(cfg, (phase, done, total) => (progress.value = { phase, done, total }));
    await saveSync(cfg, stats.value, props.edit?.rowId);
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
.filter-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  gap: 0 1rem;
}
.progress {
  width: 100%;
  height: 0.75rem;
  accent-color: var(--background-action-high-blue-france, #000091);
}
</style>
