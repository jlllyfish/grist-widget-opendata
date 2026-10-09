<template>
  <div v-if="syncs.length" class="sync-list fr-mb-4w">
    <h2 class="fr-h6 fr-mb-2w">Données data.gouv à mettre à jour</h2>
    <div v-for="s in syncs" :key="s.table" class="fr-card fr-card--sm fr-card--no-arrow fr-mb-2w">
      <div class="fr-card__body">
        <div class="fr-card__content">
          <h3 class="fr-card__title">Table {{ s.table }}</h3>
          <p class="fr-card__desc">
            {{ s.resourceTitle || s.resourceId }}<br />
            <span class="fr-text--xs">
              Clé : {{ s.keyMode === 'hash' ? 'empreinte générée' : s.keys.join(' + ') }}
              · Dernière mise à jour : {{ lastRuns[s.table] ? formatDate(lastRuns[s.table]) : '—' }}
            </span>
          </p>
          <p v-if="status[s.table]" class="fr-text--sm fr-mb-1w" :class="{ 'fr-error-text': errors[s.table] }">
            {{ status[s.table] }}
          </p>
        </div>
        <div class="fr-card__footer">
          <ul class="fr-btns-group fr-btns-group--inline-sm fr-btns-group--sm">
            <li>
              <button class="fr-btn" :disabled="running !== null" @click="refresh(s)">
                {{ running === s.table ? 'Mise à jour…' : 'Mettre à jour' }}
              </button>
            </li>
            <li>
              <button class="fr-btn fr-btn--tertiary" :disabled="running !== null" @click="forget(s.table)">
                Oublier
              </button>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, onMounted, ref } from 'vue';
import { getLastRun, loadSyncs, removeSync, runSync, type SyncConfig } from './sync';

export default defineComponent({
  name: 'SyncList',
  setup() {
    const syncs = ref<SyncConfig[]>([]);
    const running = ref<string | null>(null);
    const status = ref<Record<string, string>>({});
    const errors = ref<Record<string, boolean>>({});
    const lastRuns = ref<Record<string, string>>({});

    const reload = async () => {
      syncs.value = Object.values(await loadSyncs());
      for (const s of syncs.value) {
        const d = await getLastRun(s.table);
        if (d) lastRuns.value[s.table] = d;
      }
    };

    const formatDate = (iso: string) =>
      new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

    const refresh = async (cfg: SyncConfig) => {
      running.value = cfg.table;
      errors.value[cfg.table] = false;
      status.value[cfg.table] = 'Mise à jour en cours…';
      try {
        const st = await runSync(cfg, (step) => {
          status.value[cfg.table] = `Mise à jour en cours… (${step}/8)`;
        });
        status.value[cfg.table] =
          `✅ ${st.rows} lignes source traitées` +
          (st.removed !== null ? `, ${st.removed} supprimées` : '') +
          (st.truncated ? ' (import limité, suppressions non effectuées)' : '') +
          '.';
        await reload();
      } catch (e: any) {
        console.error(e);
        errors.value[cfg.table] = true;
        status.value[cfg.table] = e?.message || 'Erreur lors de la mise à jour.';
      } finally {
        running.value = null;
      }
    };

    const forget = async (table: string) => {
      await removeSync(table);
      await reload();
    };

    onMounted(reload);

    return { syncs, running, status, errors, lastRuns, refresh, forget, formatDate };
  },
});
</script>

<style scoped>
.sync-list {
  text-align: left;
}
</style>
