<template>
  <div>
    <div class="home-top fr-mb-3w">
      <h1 class="fr-h5 fr-mb-0">Données data.gouv.fr</h1>
      <button class="fr-btn fr-btn--icon-left fr-icon-add-line" @click="$emit('import')">Importer un jeu de données</button>
    </div>

    <p v-if="loaded && !syncs.length" class="fr-text--sm">
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
              · Dernière mise à jour : {{ lastRuns[s.table] ? formatDate(lastRuns[s.table]) : '—' }}
            </span>
          </p>
          <div v-if="status[s.table]" class="fr-card__end">
            <p class="fr-text--sm fr-mb-0" :class="{ 'fr-error-text': errors[s.table] }">{{ status[s.table] }}</p>
          </div>
        </div>
        <div class="fr-card__footer">
          <ul class="fr-btns-group fr-btns-group--inline-sm fr-btns-group--sm fr-btns-group--icon-left">
            <li>
              <button class="fr-btn fr-icon-refresh-line" :disabled="running !== null" @click="refresh(s)">
                {{ running === s.table ? 'Mise à jour…' : 'Mettre à jour' }}
              </button>
            </li>
            <li>
              <button class="fr-btn fr-btn--tertiary" :disabled="running !== null" @click="forget(s.table)">Oublier</button>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { formatStats, getLastRun, loadSyncs, removeSync, runSync, type SyncConfig } from '../sync';

defineEmits<{ import: [] }>();

const syncs = ref<SyncConfig[]>([]);
const loaded = ref(false);
const running = ref<string | null>(null);
const status = ref<Record<string, string>>({});
const errors = ref<Record<string, boolean>>({});
const lastRuns = ref<Record<string, string>>({});

const formatDate = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

async function reload() {
  syncs.value = Object.values(await loadSyncs());
  for (const s of syncs.value) {
    const d = await getLastRun(s.table);
    if (d) lastRuns.value[s.table] = d;
  }
  loaded.value = true;
}

async function refresh(cfg: SyncConfig) {
  running.value = cfg.table;
  errors.value[cfg.table] = false;
  status.value[cfg.table] = 'Mise à jour en cours…';
  try {
    const st = await runSync(cfg, (page, total) => {
      status.value[cfg.table] = `Mise à jour en cours… page ${page} / ${total}`;
    });
    status.value[cfg.table] = '✅ ' + formatStats(st);
    await reload();
  } catch (e: any) {
    console.error(e);
    errors.value[cfg.table] = true;
    status.value[cfg.table] = e?.message || 'Erreur lors de la mise à jour.';
  } finally {
    running.value = null;
  }
}

async function forget(table: string) {
  await removeSync(table);
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
