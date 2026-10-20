// Synchronisation (upsert) d'une ressource data.gouv vers une table Grist.

export const TABULAR_API = import.meta.env.VUE_APP_DATAGOUV_TABULAR_API || 'https://tabular-api.data.gouv.fr';

// Colonne horodatée par Grist (formule déclenchée NOW()) : mise à jour seulement quand une valeur de la ligne change réellement
export const MAJ_COL = 'maj_datagouv';
// Clé générée quand la source n'a pas d'identifiant : empreinte SHA-1 du contenu de la ligne
export const HASH_COL = 'cle_datagouv';
export const MAX_PAGES = 50; // ≈ 10 000 lignes
const PAGE_SIZE = 200;
const RECALC_MANUAL_UPDATES = 2; // RecalcWhen.MANUAL_UPDATES côté Grist
const OPTION_KEY = 'syncs'; // ancien stockage (options du widget), relu une fois pour migration
// Table technique (sans page) où sont mémorisées les synchronisations : ce sont des données du document,
// enregistrées immédiatement, contrairement aux options du widget qui exigent un clic sur « Enregistrer ».
export const STORE_TABLE = 'Synchro_datagouv';

export type KeyMode = 'columns' | 'hash';

export interface SyncConfig {
  table: string;
  resourceId: string;
  resourceTitle?: string;
  keyMode: KeyMode;
  keys: string[]; // colonnes Grist servant de clé (mode 'columns')
  deleteMissing: boolean;
}

export interface SavedSync extends SyncConfig {
  rowId: number;
  lastRun: string | null; // ISO
  lastReport: string;
}

export interface SyncStats {
  rows: number; // lignes lues dans la source
  added: number;
  updated: number;
  unchanged: number;
  removed: number | null; // null : suppression non demandée ou impossible (import tronqué)
  truncated: boolean;
}

export type Progress = (page: number, totalPages: number) => void;

const grist = () => window.grist;

// Les objets réactifs de Vue (Proxy) ne passent pas le postMessage vers Grist : on envoie toujours une copie simple
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// --- Identifiants Grist ---

function toIdent(str: string): string {
  return str
    .normalize('NFD')
    .replace(/\p{M}+/gu, '') // accents
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Grist préfixe par "c" les identifiants de colonne commençant par un chiffre
export const toGristColId = (key: string) => {
  const k = toIdent(key);
  return /^\d/.test(k) ? 'c' + k : k;
};

export const toGristTableId = (name: string) => {
  const k = toIdent(name) || 'Donnees';
  return /^\d/.test(k) ? 'T' + k : k.charAt(0).toUpperCase() + k.slice(1);
};

export async function createTable(name: string): Promise<string> {
  const r = await grist().docApi.applyUserActions([['AddTable', toGristTableId(name), []]]);
  return r.retValues[0].table_id;
}

const toCell = (v: any) => (v === null || v === undefined ? null : String(v));

async function rowHash(item: Record<string, any>, srcCols: string[]): Promise<string> {
  const payload = JSON.stringify(srcCols.map((k) => toCell(item[k])));
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

// --- Synchronisations mémorisées dans la table Synchro_datagouv ---

const STORE_COLUMNS: [string, object][] = [
  ['Table', { type: 'Text' }],
  ['Ressource', { type: 'Text' }],
  ['Titre', { type: 'Text' }],
  ['Mode_cle', { type: 'Text' }],
  ['Cles', { type: 'Text' }], // liste JSON
  ['Supprimer_absentes', { type: 'Bool' }],
  ['Derniere_maj', { type: 'DateTime:Europe/Paris' }],
  ['Bilan', { type: 'Text' }],
];

async function ensureStoreTable(): Promise<void> {
  const tables: string[] = await grist().docApi.listTables();
  if (tables.includes(STORE_TABLE)) return;
  // AddRawTable : table visible dans « Données brutes » uniquement, sans page ; on remplace ses colonnes A, B, C
  await grist().docApi.applyUserActions([
    ['AddRawTable', STORE_TABLE],
    ['RemoveColumn', STORE_TABLE, 'A'],
    ['RemoveColumn', STORE_TABLE, 'B'],
    ['RemoveColumn', STORE_TABLE, 'C'],
    ...STORE_COLUMNS.map(([id, info]) => ['AddColumn', STORE_TABLE, id, { isFormula: false, ...info }]),
  ]);
}

function parseKeys(v: unknown): string[] {
  try {
    const k = JSON.parse(String(v ?? '[]'));
    return Array.isArray(k) ? k.map(String) : [];
  } catch {
    return [];
  }
}

async function readStore(): Promise<Record<string, SavedSync>> {
  const tables: string[] = await grist().docApi.listTables();
  if (!tables.includes(STORE_TABLE)) return {};
  const t = await grist().docApi.fetchTable(STORE_TABLE);
  const out: Record<string, SavedSync> = {};
  (t.id as number[]).forEach((rowId, i) => {
    const table = t.Table?.[i];
    if (!table || !t.Ressource?.[i]) return;
    const ts = t.Derniere_maj?.[i];
    out[table] = {
      rowId,
      table,
      resourceId: t.Ressource[i],
      resourceTitle: t.Titre?.[i] || undefined,
      keyMode: t.Mode_cle?.[i] === 'hash' ? 'hash' : 'columns',
      keys: parseKeys(t.Cles?.[i]),
      deleteMissing: Boolean(t.Supprimer_absentes?.[i]),
      lastRun: typeof ts === 'number' ? new Date(ts * 1000).toISOString() : null,
      lastReport: t.Bilan?.[i] || '',
    };
  });
  return out;
}

// Enregistre (ou met à jour) une synchronisation, avec le résultat de son dernier passage
export async function saveSync(cfg: SyncConfig, stats?: SyncStats): Promise<void> {
  await ensureStoreTable();
  const values: Record<string, any[]> = {
    Ressource: [cfg.resourceId],
    Titre: [cfg.resourceTitle ?? ''],
    Mode_cle: [cfg.keyMode],
    Cles: [JSON.stringify(cfg.keys)],
    Supprimer_absentes: [cfg.deleteMissing],
  };
  if (stats) {
    values.Derniere_maj = [Date.now() / 1000];
    values.Bilan = [formatStats(stats)];
  }
  await grist().docApi.applyUserActions([
    ['BulkAddOrUpdateRecord', STORE_TABLE, { Table: [cfg.table] }, values, { on_many: 'first' }],
  ]);
}

export async function loadSyncs(): Promise<Record<string, SavedSync>> {
  const tables: string[] = await grist().docApi.listTables();
  if (!tables.includes(STORE_TABLE)) {
    // Migration (une seule fois) : synchronisations enregistrées par une version précédente dans les options du widget
    try {
      const legacy = ((await grist().getOption(OPTION_KEY)) as Record<string, SyncConfig> | null) ?? {};
      for (const c of Object.values(legacy)) if (c?.table && c.resourceId) await saveSync(plain(c));
    } catch {
      /* pas d'options : rien à migrer */
    }
  }
  return readStore();
}

export async function removeSync(rowId: number): Promise<void> {
  await grist().docApi.applyUserActions([['RemoveRecord', STORE_TABLE, rowId]]);
}

// --- Bilan ---

export function formatStats(st: SyncStats): string {
  const parts = [`${st.added} ajoutée(s)`, `${st.updated} mise(s) à jour`, `${st.unchanged} inchangée(s)`];
  if (st.removed !== null) parts.push(`${st.removed} supprimée(s)`);
  let msg = `${st.rows} lignes lues dans la source : ${parts.join(', ')}.`;
  if (st.truncated) msg += ` Import limité à ${MAX_PAGES} pages : suppression des lignes absentes non effectuée.`;
  return msg;
}

// --- Synchronisation ---

export async function runSync(cfgIn: SyncConfig, onProgress: Progress = () => {}): Promise<SyncStats> {
  const cfg = plain(cfgIn);
  const docApi = grist().docApi;
  const table = cfg.table;
  const hashMode = cfg.keyMode === 'hash';
  const keys = hashMode ? [HASH_COL] : [...cfg.keys];
  // En mode empreinte, une ligne modifiée devient une nouvelle ligne : l'ancienne doit disparaître
  const deleteMissing = hashMode || cfg.deleteMissing;

  // 1. Colonnes techniques ; les colonnes existantes sont conservées
  const existingCols = new Set(Object.keys(await docApi.fetchTable(table)));
  const addColumn = async (colId: string, colInfo: object): Promise<string> => {
    // AddVisibleColumn : ajoute la colonne et l'affiche dans les vues de la table
    const r = await docApi.applyUserActions([['AddVisibleColumn', table, colId, colInfo]]);
    const newId: string = r.retValues[0].colId;
    existingCols.add(newId);
    return newId;
  };

  if (!existingCols.has(MAJ_COL)) {
    // NOW() recalculé à la création de la ligne et à chaque modification réelle d'une de ses cellules.
    // Grist ignore les mises à jour sans changement de valeur : une ligne identique garde son horodatage.
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

  // État avant import : sert à compter ajouts (nouvel id) et mises à jour (date maj_datagouv changée)
  const before = await docApi.fetchTable(table);
  const majBefore = new Map<number, unknown>((before.id as number[]).map((rid, i) => [rid, before[MAJ_COL]?.[i]]));

  // 2. Pages de l'API tabulaire → BulkAddOrUpdateRecord
  const colIdOf: Record<string, string> = {}; // nom source -> id de colonne Grist
  const seen = new Set<string>();
  let rows = 0;
  let totalPages = 1;

  for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page++) {
    const resp = await fetch(
      `${TABULAR_API}/api/resources/${cfg.resourceId}/data/?page_size=${PAGE_SIZE}&page=${page}`,
    );
    if (!resp.ok) throw new Error(`Erreur de l'API tabulaire data.gouv (${resp.status}).`);
    const result = await resp.json();
    totalPages = Math.max(1, Math.ceil((result.meta?.total ?? 0) / PAGE_SIZE));
    onProgress(page, Math.min(totalPages, MAX_PAGES));
    const data: any[] = result.data ?? [];
    if (data.length === 0) break;

    for (const item of data) {
      for (const src of Object.keys(item)) {
        if (src === '__id' || src in colIdOf) continue;
        const colId = toGristColId(src);
        if (colId === 'id') continue;
        // Colonne vide (comme le widget d'origine) : Grist la transforme en colonne de données au premier remplissage
        colIdOf[src] = existingCols.has(colId)
          ? colId
          : await addColumn(colId, { isFormula: true, type: 'Any', formula: '' });
      }
    }
    if (!hashMode) {
      const missing = keys.filter((k) => !Object.values(colIdOf).includes(k));
      if (missing.length) throw new Error(`Colonne(s) clé introuvable(s) dans la source : ${missing.join(', ')}`);
    }

    const srcCols = Object.keys(colIdOf).sort();
    const require: Record<string, any[]> = Object.fromEntries(keys.map((k) => [k, []]));
    const values: Record<string, any[]> = {};
    for (const item of data) {
      if (hashMode) require[HASH_COL].push(await rowHash(item, srcCols));
      for (const [src, colId] of Object.entries(colIdOf)) {
        const v = toCell(item[src]);
        if (keys.includes(colId)) require[colId].push(v);
        else (values[colId] ??= []).push(v);
      }
      seen.add(JSON.stringify(keys.map((k) => require[k][require[k].length - 1])));
    }

    await docApi.applyUserActions([['BulkAddOrUpdateRecord', table, require, values, { on_many: 'first' }]]);
    rows += data.length;
  }

  // 3. Suppression des lignes disparues de la source (seulement si tout a été lu) et bilan
  const truncated = totalPages > MAX_PAGES;
  const current = await docApi.fetchTable(table);
  const removedIds = new Set<number>();
  let removed: number | null = null;
  if (deleteMissing && !truncated) {
    (current.id as number[]).forEach((rid, i) => {
      if (!seen.has(JSON.stringify(keys.map((k) => current[k][i])))) removedIds.add(rid);
    });
    if (removedIds.size) await docApi.applyUserActions([['BulkRemoveRecord', table, [...removedIds]]]);
    removed = removedIds.size;
  }

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  (current.id as number[]).forEach((rid, i) => {
    if (removedIds.has(rid)) return;
    if (!majBefore.has(rid)) added++;
    else if (JSON.stringify(majBefore.get(rid)) !== JSON.stringify(current[MAJ_COL][i])) updated++;
    else unchanged++;
  });

  return { rows, added, updated, unchanged, removed, truncated };
}
