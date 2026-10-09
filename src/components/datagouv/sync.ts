// Synchronisation (upsert) d'une ressource data.gouv vers une table Grist.
// Utilisé à l'import initial (ImporterForm) et pour les mises à jour en un clic (SyncList).
import { processString } from '@/utils';

// Colonne horodatée par Grist (formule déclenchée NOW()) : mise à jour seulement quand une valeur de la ligne change réellement
export const MAJ_COL = 'maj_datagouv';
// Clé générée quand la source n'a pas d'identifiant : empreinte SHA-1 du contenu de la ligne
export const HASH_COL = 'cle_datagouv';
export const MAX_PAGES = 50; // même plafond que le mode remplacement (≈ 10 000 lignes)
const PAGE_SIZE = 200;
const RECALC_MANUAL_UPDATES = 2; // RecalcWhen.MANUAL_UPDATES côté Grist
const OPTION_KEY = 'syncs';

export type KeyMode = 'columns' | 'hash';

export interface SyncConfig {
  table: string;
  resourceId: string;
  resourceTitle?: string;
  keyMode: KeyMode;
  keys: string[]; // colonnes Grist servant de clé (mode 'columns')
  deleteMissing: boolean;
}

export interface SyncStats {
  rows: number;
  removed: number | null;
  truncated: boolean;
}

interface SyncContext {
  docId: string;
  gristUrl: string;
  tabularapiUrl: string;
}

// Grist préfixe par "c" les identifiants de colonne commençant par un chiffre
export const toGristColId = (key: string) => {
  const k = processString(key);
  return /^\d/.test(k) ? 'c' + k : k;
};
const toCell = (v: any) => (v === null || v === undefined ? null : String(v));

async function rowHash(item: Record<string, any>, srcCols: string[]): Promise<string> {
  const payload = JSON.stringify(srcCols.map((k) => toCell(item[k])));
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getContext(): Promise<SyncContext> {
  const docId = await window.grist.docApi.getDocName();
  let gristUrl = import.meta.env.VUE_APP_GRIST_URL || '';
  try {
    const res = await window.grist.getAccessToken();
    gristUrl = res.baseUrl.split('/o/')[0];
  } catch {
    /* on garde la valeur par défaut */
  }
  return { docId, gristUrl, tabularapiUrl: import.meta.env.VUE_APP_DATAGOUV_TABULAR_API ?? '' };
}

// --- Mémorisation des synchronisations dans les options du widget (stockées dans le document) ---

export async function loadSyncs(): Promise<Record<string, SyncConfig>> {
  try {
    return ((await window.grist.getOption(OPTION_KEY)) as Record<string, SyncConfig>) ?? {};
  } catch {
    return {};
  }
}

// Les objets réactifs de Vue (Proxy) ne passent pas le postMessage vers Grist : on envoie toujours une copie simple
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export async function saveSync(cfg: SyncConfig): Promise<void> {
  const all = await loadSyncs();
  all[cfg.table] = plain(cfg);
  await window.grist.setOption(OPTION_KEY, plain(all));
}

// Toute écriture dans les options fait apparaître le bouton « Enregistrer » de Grist :
// on n'enregistre la config que si elle a réellement changé.
export async function saveSyncIfChanged(cfg: SyncConfig): Promise<boolean> {
  const all = await loadSyncs();
  if (JSON.stringify(all[cfg.table]) === JSON.stringify(plain(cfg))) return false;
  await saveSync(cfg);
  return true;
}

// Date du dernier passage : stockée dans le navigateur pour ne pas modifier le document à chaque mise à jour
const lastRunKey = (docId: string, table: string) => `datagouv-sync:${docId}:${table}`;

export async function getLastRun(table: string): Promise<string | null> {
  try {
    return localStorage.getItem(lastRunKey(await window.grist.docApi.getDocName(), table));
  } catch {
    return null;
  }
}

export async function removeSync(table: string): Promise<void> {
  const all = await loadSyncs();
  delete all[table];
  await window.grist.setOption(OPTION_KEY, plain(all));
}

// --- Synchronisation ---

async function getRawSectionParentId(ctx: SyncContext, table: string, token: string) {
  const resp = await fetch(`${ctx.gristUrl}/api/docs/${ctx.docId}/tables/?auth=${token}`);
  if (!resp.ok) throw new Error(`HTTP error! status: ${resp.status}`);
  const tables = await resp.json();
  const t = tables.tables.find((tb: { id: string }) => tb.id === table);
  return t ? t.fields.rawViewSectionRef - 1 : 1; // même logique que le mode remplacement
}

export async function runSync(
  cfgIn: SyncConfig,
  onProgress: (step: number) => void = () => {},
): Promise<SyncStats> {
  const cfg = plain(cfgIn);
  const ctx = await getContext();
  const docApi = window.grist.docApi;
  const table = cfg.table;
  const hashMode = cfg.keyMode === 'hash';
  const keys = hashMode ? [HASH_COL] : [...cfg.keys];
  // En mode empreinte, une ligne modifiée devient une nouvelle ligne : l'ancienne doit disparaître
  const deleteMissing = hashMode || cfg.deleteMissing;
  onProgress(2);

  // 1. Colonnes : on conserve l'existant, on n'ajoute que ce qui manque
  const existingCols = new Set(Object.keys(await docApi.fetchTable(table)));
  const tokenInfo = await docApi.getAccessToken({ readOnly: true });
  const parentId = await getRawSectionParentId(ctx, table, tokenInfo.token);

  const addColumn = async (colId: string, colInfo: object): Promise<string> => {
    const r = await docApi.applyUserActions([['AddColumn', table, colId, colInfo]]);
    const ret = r.retValues[0];
    await docApi.applyUserActions([
      ['AddRecord', '_grist_Views_section_field', null, { parentPos: null, parentId, colRef: ret.colRef }],
    ]);
    existingCols.add(ret.colId);
    return ret.colId;
  };

  if (!existingCols.has(MAJ_COL)) {
    // Formule déclenchée : NOW() recalculé à la création de la ligne et à chaque modification réelle d'une de ses cellules.
    // Grist ignore les mises à jour sans changement de valeur, donc une ligne identique garde son horodatage.
    await addColumn(MAJ_COL, {
      type: 'DateTime:Europe/Paris',
      isFormula: false,
      formula: 'NOW()',
      recalcWhen: RECALC_MANUAL_UPDATES,
    });
  }
  if (hashMode && !existingCols.has(HASH_COL)) {
    await addColumn(HASH_COL, { type: 'Text', isFormula: false });
  }
  onProgress(3);

  // 2. Pages de l'API tabulaire → BulkAddOrUpdateRecord
  const colIdOf: Record<string, string> = {}; // nom source -> id de colonne Grist
  const seen = new Set<string>();
  let rows = 0;
  let totalPages = 1;

  for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page++) {
    const resp = await fetch(
      `${ctx.tabularapiUrl}/api/resources/${cfg.resourceId}/data/?page_size=${PAGE_SIZE}&page=${page}`,
    );
    if (!resp.ok) throw new Error(`Erreur API tabulaire (${resp.status}).`);
    const result = await resp.json();
    totalPages = Math.max(1, Math.ceil((result.meta?.total ?? 0) / PAGE_SIZE));
    onProgress(Math.min(8, 3 + Math.floor((page * 5) / Math.min(totalPages, MAX_PAGES))));
    const data: any[] = result.data ?? [];
    if (data.length === 0) break;

    for (const item of data) {
      for (const src of Object.keys(item)) {
        if (src === '__id' || src in colIdOf) continue;
        const colId = toGristColId(src);
        if (colId === 'id') continue;
        colIdOf[src] = existingCols.has(colId)
          ? colId
          : await addColumn(colId, { isFormula: true, type: 'Any', formula: '' });
      }
    }
    if (!hashMode) {
      const missingKeys = keys.filter((k) => !Object.values(colIdOf).includes(k));
      if (missingKeys.length) throw new Error(`Colonne(s) clé introuvable(s) : ${missingKeys.join(', ')}`);
    }

    const srcCols = Object.keys(colIdOf).sort();
    const require: Record<string, any[]> = Object.fromEntries(keys.map((k) => [k, []]));
    const values: Record<string, any[]> = {};
    for (const item of data) {
      if (hashMode) require[HASH_COL].push(await rowHash(item, srcCols));
      for (const [src, colId] of Object.entries(colIdOf)) {
        const v = toCell(item[src]);
        if (keys.includes(colId)) {
          require[colId].push(v);
        } else {
          (values[colId] ??= []).push(v);
        }
      }
      seen.add(JSON.stringify(keys.map((k) => require[k][require[k].length - 1])));
    }

    await docApi.applyUserActions([['BulkAddOrUpdateRecord', table, require, values, { on_many: 'first' }]]);
    rows += data.length;
  }

  // 3. Suppression des lignes disparues de la source (seulement si on a tout lu)
  const truncated = totalPages > MAX_PAGES;
  let removed: number | null = null;
  if (deleteMissing && !truncated) {
    const current = await docApi.fetchTable(table);
    const toRemove = (current.id as number[]).filter(
      (_, i) => !seen.has(JSON.stringify(keys.map((k) => current[k][i]))),
    );
    if (toRemove.length) await docApi.applyUserActions([['BulkRemoveRecord', table, toRemove]]);
    removed = toRemove.length;
  }

  try {
    localStorage.setItem(lastRunKey(ctx.docId, table), new Date().toISOString());
  } catch {
    /* stockage navigateur indisponible : sans conséquence */
  }
  return { rows, removed, truncated };
}
