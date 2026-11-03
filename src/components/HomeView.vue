<template>
  <div>
    <div class="home-top fr-mb-3w">
      <h1 class="fr-h5 fr-mb-0">Données data.gouv.fr</h1>
      <button class="fr-btn fr-btn--icon-left fr-icon-add-line" @click="$emit('import')">Importer un jeu de données</button>
    </div>

    <div v-if="loadError" class="fr-alert fr-alert--error fr-alert--sm fr-mb-3w">
      <p>{{ loadError }}</p>
    </div>

    <p v-if="loaded && !syncs.length && !loadError" class="fr-text--sm">
      Aucune donnée synchronisée dans ce document. Importez un jeu de données data.gouv.fr : vous pourrez ensuite le
      mettre à jour en un clic depuis cet écran.
    </p>

    <div v-for="s in syncs" :key="s.table" class="fr-card fr-card--sm fr-card--no-arrow fr-mb-2w">
      <div class="fr-card__body">
        <div class="fr-card__content">
          <h2 class="fr-card__title">Table {{ s.table }}</h2>
          <p class="fr-card__desc">
            {{ s.resourceTitle || s.resourceId }}<br />
            <span class="fr-text--xs">
              Clé : {{ s.keyMode === 'hash' ? 'empreinte générée' : s.keys.join(' + ') }}
              · Dernière mise à jour : {{ s.lastRun ? formatDate(s.lastRun) : '—' }}
            </span>
          </p>
          <div class="fr-card__start">
            <p v-if="newData[s.table]" class="fr-badge fr-badge--sm fr-badge--new">
              Nouvelles données publiées le {{ formatDate(newData[s.table]) }}
            </p>
            <p v-else-if="s.lastRun && checked[s.table]" class="fr-badge fr-badge--sm fr-badge--success">À jour</p>
          </div>
          <div v-if="status[s.table] || s.lastReport" class="fr-card__end">
            <p class="fr-text--sm fr-mb-0" :class="{ 'fr-error-text': errors[s.table] }">
              {{ status[s.table] || 'Dernier bilan : ' + s.lastReport }}
            </p>
          </div>
        </div>
        <div class="fr-card__footer">
          <ul class="fr-btns-group fr-btns-group--inline-sm fr-btns-group--sm fr-btns-group--icon-left">
            <li>
              <button
                class="fr-btn fr-icon-refresh-line"
                :class="{ 'fr-btn--secondary': !newData[s.table] && s.lastRun }"
                :disabled="running !== null"
                @click="refresh(s)"
              >
                {{ running === s.table ? 'Mise à jour…' : 'Mettre à jour' }}
              </button>
            </li>
            <li>
              <button class="fr-btn fr-btn--tertiary" :disabled="running !== null" @click="forget(s)">Oublier</button>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { resourceLastModified } from '../datagouv';
import { STORE_TABLE, formatStats, loadSyncs, removeSync, runSync, saveSync, type SavedSync } from '../sync';

defineEmits<{ import: [] }>();

const syncs = ref<SavedSync[]>([]);
const loaded = ref(false);
const loadError = ref('');
const running = ref<string | null>(null);
const status = ref<Record<string, string>>({});
const errors = ref<Record<string, boolean>>({});
const newData = ref<Record<string, string>>({}); // table -> date de publication sur data.gouv, si plus récente
const checked = ref<Record<string, boolean>>({});

const formatDate = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

// Signale les ressources modifiées sur data.gouv.fr depuis la dernière mise à jour
async function checkFreshness(s: SavedSync) {
  const modified = await resourceLastModified(s.resourceId);
  if (modified && (!s.lastRun || new Date(modified) > new Date(s.lastRun))) newData.value[s.table] = modified;
  else delete newData.value[s.table];
  checked.value[s.table] = modified !== null;
}

async function reload() {
  try {
    syncs.value = Object.values(await loadSyncs());
    loadError.value = '';
  } catch (e: any) {
    console.error(e);
    loadError.value = `Impossible de lire la table ${STORE_TABLE} : ${e?.message ?? e}`;
  }
  loaded.value = true;
  await Promise.all(syncs.value.map(checkFreshness));
}

async function refresh(s: SavedSync) {
  running.value = s.table;
  errors.value[s.table] = false;
  status.value[s.table] = 'Mise à jour en cours…';
  try {
    const st = await runSync(s, (phase, done, total) => {
      status.value[s.table] =
        phase === 'lecture'
          ? `Lecture des données data.gouv.fr… page ${done} / ${total}`
          : `Écriture dans Grist… ${done.toLocaleString('fr-FR')} / ${total.toLocaleString('fr-FR')} lignes`;
    });
    await saveSync(s, st);
    status.value[s.table] = '✅ ' + formatStats(st);
    await reload();
  } catch (e: any) {
    console.error(e);
    errors.value[s.table] = true;
    status.value[s.table] = e?.message || 'Erreur lors de la mise à jour.';
  } finally {
    running.value = null;
  }
}

async function forget(s: SavedSync) {
  await removeSync(s.rowId);
  await reload();
}

onMounted(reload);
</script>

<style scoped>
.home-top {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
}
</style>
