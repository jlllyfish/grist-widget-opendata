// Synchronisation (upsert) d'une ressource data.gouv vers une table Grist.

export const TABULAR_API = import.meta.env.VUE_APP_DATAGOUV_TABULAR_API || 'https://tabular-api.data.gouv.fr';

// Colonne horodatée par Grist (formule déclenchée NOW()) : mise à jour seulement quand une valeur de la ligne change réellement
export const MAJ_COL = 'maj_datagouv';
// Clé générée quand la source n'a pas d'identifiant : empreinte SHA-1 du contenu de la ligne
export const HASH_COL = 'cle_datagouv';
export const MAX_ROWS = 50_000; // lignes lues au maximum par ressource
const PAGE_SIZE = 200; // lignes par requête à l'API tabulaire
const WRITE_BATCH = 500; // lignes par écriture dans Grist
// RecalcWhen.DEFAULT côté Grist : calcul à la création de la ligne, puis quand une colonne de recalcDeps change
const RECALC_DEFAULT = 0;
const OPTION_KEY = 'syncs'; // ancien stockage (options du widget), relu une fois pour migration
// Table technique (sans page) où sont mémorisées les synchronisations : ce sont des données du document,
// enregistrées immédiatement, contrairement aux options du widget qui exigent un clic sur « Enregistrer ».
export const STORE_TABLE = 'Synchro_datagouv';

export type KeyMode = 'columns' | 'hash';

// Filtre appliqué côté data.gouv (API tabulaire) avant import
export type FilterOp = 'exact' | 'in' | 'contains' | 'differs';
export interface SyncFilter {
  column: string; // nom de la colonne dans la source
  op: FilterOp;
  value: string; // pour 'in' : valeurs séparées par « ; »
}

export const FILTER_OPS: Record<FilterOp, string> = {
  exact: 'est égal à',
  in: 'est parmi (valeurs séparées par ;)',
  contains: 'contient',
  differs: 'est différent de',
};

const inValues = (value: string) =>
  value
    .split(';')
    .map((v) => v.trim())
    .filter(Boolean);

// Paramètre de requête de l'API tabulaire (ex. uai_insee_reg__exact=76) ; chaîne vide si pas de filtre
export function filterQuery(f?: SyncFilter | null): string {
  if (!f?.column || !f.value.trim()) return '';
  const value =
    f.op === 'in' ? inValues(f.value).map((v) => `"${v.replace(/"/g, '')}"`).join(',') : f.value.trim();
  return `${encodeURIComponent(f.column)}__${f.op}=${encodeURIComponent(value)}`;
}

export function filterLabel(f?: SyncFilter | null): string {
  if (!f?.column || !f.value.trim()) return '';
  const value = f.op === 'in' ? inValues(f.value).join(', ') : f.value.trim();
  return `${f.column} ${FILTER_OPS[f.op].replace(/ \(.*\)$/, '')} ${value}`;
}

export interface SyncConfig {
  table: string;
  resourceId: string;
  resourceTitle?: string;
  keyMode: KeyMode;
  keys: string[]; // colonnes Grist servant de clé (mode 'columns')
  deleteMissing: boolean;
  // Colonnes Grist ignorées pour détecter les changements (ex. date_jeu_donnees, qui change à chaque publication) :
  // elles sont importées, mais ne modifient ni maj_datagouv ni l'empreinte
  ignored?: string[];
  filter?: SyncFilter | null;
}

export interface SavedSync extends SyncConfig {
  rowId: number;
  lastRun: string | null; // ISO
  lastReport: string;
}

export interface SyncStats {
  total: number; // lignes de la ressource sur data.gouv.fr
  rows: number; // lignes lues dans la source
  added: number;
  updated: number;
  unchanged: number;
  removed: number | null; // null : suppression non demandée ou impossible (import tronqué)
  truncated: boolean;
  filter?: string; // libellé du filtre appliqué
}

export type Progress = (phase: 'lecture' | 'écriture', done: number, total: number) => void;

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
const toText = (v: any) => (v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v));

// Valeur adaptée au type de la colonne Grist de destination
function coerce(v: any, type: string): any {
  if (v === null || v === undefined || v === '') return v ?? null;
  if (type === 'Int' || type === 'Numeric') {
    if (typeof v === 'number') return v;
    const n = Number(String(v).trim());
    return Number.isFinite(n) ? n : String(v);
  }
  if (type === 'Bool') {
    if (typeof v === 'boolean') return v;
    const t = String(v).trim().toLowerCase();
    return ['true', '1', 'oui', 'vrai'].includes(t) ? true : ['false', '0', 'non', 'faux'].includes(t) ? false : String(v);
  }
  if (type === 'Any') return typeof v === 'object' ? JSON.stringify(v) : v;
  return toText(v);
}

// Forme canonique d'une valeur de clé, pour comparer la source et Grist quel que soit le type (1, 1.0 et "1")
const canon = (v: any) => (v === null || v === undefined ? '' : String(v));

// Type Grist d'une colonne d'après le profil data.gouv (csv-detective) ; texte par défaut, pour ne rien altérer
const GRIST_TYPE: Record<string, string> = { int: 'Int', float: 'Numeric', bool: 'Bool' };

async function sha1(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
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
  ['Ignorees', { type: 'Text' }], // liste JSON
  ['Filtre', { type: 'Text' }], // objet JSON (SyncFilter)
  ['Derniere_maj', { type: 'DateTime:Europe/Paris' }],
  ['Bilan', { type: 'Text' }],
];

async function ensureStoreTable(): Promise<void> {
  const tables: string[] = await grist().docApi.listTables();
  if (tables.includes(STORE_TABLE)) {
    // Table créée par une version précédente : on ajoute les colonnes apparues depuis
    const existing = Object.keys(await grist().docApi.fetchTable(STORE_TABLE));
    const missing = STORE_COLUMNS.filter(([id]) => !existing.includes(id));
    if (missing.length) {
      await grist().docApi.applyUserActions(
        missing.map(([id, info]) => ['AddColumn', STORE_TABLE, id, { isFormula: false, ...info }]),
      );
    }
    return;
  }
  // AddRawTable : table visible dans « Données brutes » uniquement, sans page ; on remplace ses colonnes A, B, C
  await grist().docApi.applyUserActions([
    ['AddRawTable', STORE_TABLE],
    ['RemoveColumn', STORE_TABLE, 'A'],
    ['RemoveColumn', STORE_TABLE, 'B'],
    ['RemoveColumn', STORE_TABLE, 'C'],
    ...STORE_COLUMNS.map(([id, info]) => ['AddColumn', STORE_TABLE, id, { isFormula: false, ...info }]),
  ]);
}

function parseFilter(v: unknown): SyncFilter | null {
  try {
    const f = JSON.parse(String(v ?? 'null'));
    return f && typeof f.column === 'string' && typeof f.value === 'string' && f.op in FILTER_OPS ? f : null;
  } catch {
    return null;
  }
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
      ignored: parseKeys(t.Ignorees?.[i]),
      filter: parseFilter(t.Filtre?.[i]),
      lastRun: typeof ts === 'number' ? new Date(ts * 1000).toISOString() : null,
      lastReport: t.Bilan?.[i] || '',
    };
  });
  return out;
}

// Enregistre (ou met à jour) une synchronisation, avec le résultat de son dernier passage.
// rowId : ligne existante à modifier (changement de table de destination) ; sinon, rapprochement par nom de table.
export async function saveSync(cfg: SyncConfig, stats?: SyncStats, rowId?: number): Promise<void> {
  await ensureStoreTable();
  const values: Record<string, any[]> = {
    Ressource: [cfg.resourceId],
    Titre: [cfg.resourceTitle ?? ''],
    Mode_cle: [cfg.keyMode],
    Cles: [JSON.stringify(cfg.keys)],
    Supprimer_absentes: [cfg.deleteMissing],
    Ignorees: [JSON.stringify(cfg.ignored ?? [])],
    Filtre: [filterLabel(cfg.filter) ? JSON.stringify(cfg.filter) : ''],
  };
  if (stats) {
    values.Derniere_maj = [Date.now() / 1000];
    values.Bilan = [formatStats(stats)];
  }
  if (rowId) {
    const fields = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v[0]]));
    await grist().docApi.applyUserActions([['UpdateRecord', STORE_TABLE, rowId, { Table: cfg.table, ...fields }]]);
    return;
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

const fmt = (n: number) => n.toLocaleString('fr-FR');

export function formatStats(st: SyncStats): string {
  const parts = [`${fmt(st.added)} ajoutée(s)`, `${fmt(st.updated)} mise(s) à jour`, `${fmt(st.unchanged)} inchangée(s)`];
  if (st.removed !== null) parts.push(`${fmt(st.removed)} supprimée(s)`);
  const total = st.total ?? st.rows;
  let msg = `${fmt(total)} lignes sur data.gouv.fr${st.filter ? ` (filtre : ${st.filter})` : ''} : ${parts.join(', ')}.`;
  if (st.truncated) {
    msg += ` Seules les ${fmt(st.rows)} premières ont été lues (limite du widget) : suppression des lignes absentes non effectuée.`;
  }
  return msg;
}

// --- Lecture de la source ---

async function fetchJson(url: string) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Erreur de l'API tabulaire data.gouv (${resp.status}).`);
  return resp.json();
}

// Types des colonnes source (profil csv-detective) ; vide si indisponible
async function sourceTypes(resourceId: string): Promise<Record<string, string>> {
  try {
    const p = await fetchJson(`${TABULAR_API}/api/resources/${resourceId}/profile/`);
    const cols: Record<string, any> = p?.profile?.columns ?? {};
    return Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, GRIST_TYPE[v?.python_type] ?? 'Text']));
  } catch {
    return {};
  }
}

async function readSource(resourceId: string, filter: SyncFilter | null | undefined, onProgress: Progress) {
  const q = filterQuery(filter);
  const rows: any[] = [];
  let total = 0;
  const pages = () => Math.max(1, Math.ceil(Math.min(total, MAX_ROWS) / PAGE_SIZE));
  for (let page = 1; page <= pages(); page++) {
    const result = await fetchJson(
      `${TABULAR_API}/api/resources/${resourceId}/data/?page_size=${PAGE_SIZE}&page=${page}${q ? '&' + q : ''}`,
    );
    total = result.meta?.total ?? 0;
    const data: any[] = result.data ?? [];
    rows.push(...data);
    onProgress('lecture', page, pages());
    if (data.length < PAGE_SIZE) break; // dernière page
  }
  return { rows: rows.slice(0, MAX_ROWS), total: Math.max(total, rows.length) };
}

interface ColumnMeta {
  ref: number;
  type: string;
  recalcWhen?: number;
  recalcDeps?: number[];
}

// RefList encodée par Grist : ['L', 1, 2, …]
const refList = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []);

// Colonnes de la table Grist (métadonnées du document)
async function columnMeta(table: string): Promise<Record<string, ColumnMeta>> {
  const docApi = grist().docApi;
  const tables = await docApi.fetchTable('_grist_Tables');
  const ref = (tables.id as number[])[(tables.tableId as string[]).indexOf(table)];
  const cols = await docApi.fetchTable('_grist_Tables_column');
  const out: Record<string, ColumnMeta> = {};
  (cols.id as number[]).forEach((colRef, i) => {
    if (cols.parentId[i] !== ref) return;
    out[cols.colId[i]] = {
      ref: colRef,
      type: String(cols.type[i]).split(':')[0],
      recalcWhen: cols.recalcWhen?.[i],
      recalcDeps: refList(cols.recalcDeps?.[i]),
    };
  });
  return out;
}

// --- Synchronisation ---

export async function runSync(cfgIn: SyncConfig, onProgress: Progress = () => {}): Promise<SyncStats> {
  const cfg = plain(cfgIn);
  const docApi = grist().docApi;
  const table = cfg.table;
  const hashMode = cfg.keyMode === 'hash';
  const keys = hashMode ? [HASH_COL] : [...cfg.keys];
  const ignored = new Set(cfg.ignored ?? []);
  // En mode empreinte, une ligne modifiée devient une nouvelle ligne : l'ancienne doit disparaître
  const deleteMissing = hashMode || cfg.deleteMissing;

  // 1. Lecture complète de la source, avant toute écriture
  const [{ rows, total }, srcTypes] = await Promise.all([
    readSource(cfg.resourceId, cfg.filter, onProgress),
    sourceTypes(cfg.resourceId),
  ]);
  const truncated = total > rows.length;
  if (!rows.length) {
    // Garde-fou : une source vide (ou un filtre trop strict) viderait la table
    throw new Error(
      filterLabel(cfg.filter)
        ? `Le filtre « ${filterLabel(cfg.filter)} » ne renvoie aucune ligne : rien n'a été modifié.`
        : "La ressource ne contient aucune ligne : rien n'a été modifié.",
    );
  }
  const srcCols = Object.keys(rows[0] ?? {})
    .filter((src) => src !== '__id' && toGristColId(src) !== 'id')
    .sort();
  const colIdOf: Record<string, string> = Object.fromEntries(srcCols.map((src) => [src, toGristColId(src)]));

  if (!hashMode) {
    const missing = keys.filter((k) => !Object.values(colIdOf).includes(k));
    if (missing.length) throw new Error(`Colonne(s) clé introuvable(s) dans la source : ${missing.join(', ')}`);
  }

  // 2. Colonnes : on conserve l'existant et on ajoute ce qui manque, avec un type explicite
  //    (sans type, Grist devine : « 01004 » deviendrait le nombre 1004)
  const meta = await columnMeta(table);
  const types: Record<string, string> = Object.fromEntries(Object.entries(meta).map(([k, m]) => [k, m.type]));
  const addColumn = async (colId: string, colInfo: { type: string; [k: string]: unknown }): Promise<string> => {
    // AddVisibleColumn : ajoute la colonne et l'affiche dans les vues de la table
    const r = await docApi.applyUserActions([['AddVisibleColumn', table, colId, colInfo]]);
    const { colId: newId, colRef } = r.retValues[0];
    types[newId] = colInfo.type.split(':')[0];
    meta[newId] = { ref: colRef, type: types[newId] };
    return newId;
  };
  if (!(MAJ_COL in types)) {
    // Formule déclenchée NOW() : calculée à la création de la ligne, puis quand une colonne surveillée change
    // (liste fixée plus bas). Grist ignore les écritures sans changement : une ligne identique garde sa date.
    await addColumn(MAJ_COL, {
      type: 'DateTime:Europe/Paris',
      isFormula: false,
      formula: 'NOW()',
      recalcWhen: RECALC_DEFAULT,
    });
  }
  if (hashMode && !(HASH_COL in types)) await addColumn(HASH_COL, { type: 'Text', isFormula: false });
  for (const src of srcCols) {
    const colId = colIdOf[src];
    if (colId in types) continue;
    const type = keys.includes(colId) ? 'Text' : (srcTypes[src] ?? 'Text');
    colIdOf[src] = await addColumn(colId, { type, isFormula: false });
  }

  // maj_datagouv ne surveille que les colonnes de la source non ignorées (pas les colonnes ajoutées à la main)
  const watched = srcCols
    .map((src) => colIdOf[src])
    .filter((c) => !ignored.has(c))
    .map((c) => meta[c].ref)
    .sort((a, b) => a - b);
  const majMeta = meta[MAJ_COL];
  if (majMeta.recalcWhen !== RECALC_DEFAULT || JSON.stringify(majMeta.recalcDeps ?? []) !== JSON.stringify(watched)) {
    // Même action que l'interface de Grist (panneau « formule déclenchée »)
    await docApi.applyUserActions([
      ['UpdateRecord', '_grist_Tables_column', majMeta.ref, { recalcWhen: RECALC_DEFAULT, recalcDeps: ['L', ...watched] }],
    ]);
  }

  // 3. Clés de rapprochement
  const hashCols = srcCols.filter((src) => !ignored.has(colIdOf[src]));
  const keyValues: any[][] = []; // par ligne, valeurs des colonnes clés (au type de la colonne)
  const occurrences = new Map<string, number>();
  for (const item of rows) {
    if (hashMode) {
      // Empreinte du contenu (hors colonnes ignorées) ; les lignes identiques sont numérotées pour rester distinctes
      const h = await sha1(JSON.stringify(hashCols.map((k) => toCell(item[k]))));
      const n = occurrences.get(h) ?? 0;
      occurrences.set(h, n + 1);
      keyValues.push([n === 0 ? h : `${h}-${n + 1}`]);
    } else {
      const srcOf = (k: string) => srcCols.find((src) => colIdOf[src] === k)!;
      keyValues.push(keys.map((k) => coerce(item[srcOf(k)], types[k])));
    }
  }
  const keyIds = keyValues.map((kv) => JSON.stringify(kv.map(canon)));
  if (!hashMode) {
    const count = new Map<string, number>();
    for (const id of keyIds) count.set(id, (count.get(id) ?? 0) + 1);
    const dups = [...count].filter(([, n]) => n > 1);
    if (dups.length) {
      const examples = dups.slice(0, 3).map(([id, n]) => `${(JSON.parse(id) as string[]).join(' + ') || '(vide)'} ×${n}`);
      throw new Error(
        `La clé ${keys.join(' + ')} n'est pas unique : ${fmt(dups.length)} valeur(s) en double dans la source ` +
          `(ex. : ${examples.join(', ')}). Rien n'a été modifié. Ajoutez une colonne à la clé ou choisissez la clé générée.`,
      );
    }
  }

  // État avant import : sert à compter ajouts (nouvel id) et mises à jour (date maj_datagouv changée)
  const before = await docApi.fetchTable(table);
  const majBefore = new Map<number, unknown>((before.id as number[]).map((rid, i) => [rid, before[MAJ_COL]?.[i]]));

  // 4. Écriture par lots → BulkAddOrUpdateRecord
  for (let start = 0; start < rows.length; start += WRITE_BATCH) {
    const batch = rows.slice(start, start + WRITE_BATCH);
    const require: Record<string, any[]> = Object.fromEntries(keys.map((k) => [k, []]));
    const values: Record<string, any[]> = {};
    batch.forEach((item, j) => {
      keys.forEach((k, ki) => require[k].push(keyValues[start + j][ki]));
      for (const src of srcCols) {
        const colId = colIdOf[src];
        if (!keys.includes(colId)) (values[colId] ??= []).push(coerce(item[src], types[colId]));
      }
    });
    await docApi.applyUserActions([['BulkAddOrUpdateRecord', table, require, values, { on_many: 'first' }]]);
    onProgress('écriture', Math.min(start + WRITE_BATCH, rows.length), rows.length);
  }

  // 5. Suppression des lignes disparues de la source (seulement si tout a été lu) et bilan
  const seen = new Set(keyIds);
  const current = await docApi.fetchTable(table);
  const removedIds = new Set<number>();
  let removed: number | null = null;
  if (deleteMissing && !truncated) {
    (current.id as number[]).forEach((rid, i) => {
      if (!seen.has(JSON.stringify(keys.map((k) => canon(current[k][i]))))) removedIds.add(rid);
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

  return { total, rows: rows.length, added, updated, unchanged, removed, truncated, filter: filterLabel(cfg.filter) || undefined };
}
