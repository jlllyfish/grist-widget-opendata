// Recherche de ressources tabulaires sur data.gouv.fr (API publique, sans authentification).
import { TABULAR_API, filterQuery, toGristColId, type SyncFilter } from './sync';

export const DATAGOUV_URL = import.meta.env.VUE_APP_DATAGOUV_IMPORT_URL || 'https://www.data.gouv.fr';

export interface Resource {
  id: string;
  title: string;
  datasetTitle: string;
  organization?: string;
}

// Seules les ressources analysées par data.gouv sont disponibles dans l'API tabulaire
const isTabular = (r: any) => Boolean(r?.extras?.['analysis:parsing:finished_at']);

async function getJson(url: string) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`data.gouv a répondu ${resp.status} pour ${url}`);
  return resp.json();
}

async function datasetResources(ds: any): Promise<Resource[]> {
  const res = await getJson(ds.resources.href);
  return (res.data ?? []).filter(isTabular).map((r: any) => ({
    id: r.id,
    title: r.title,
    datasetTitle: ds.title,
    organization: ds.organization?.name,
  }));
}

export async function searchResources(query: string): Promise<Resource[]> {
  const result = await getJson(`${DATAGOUV_URL}/api/2/datasets/search/?q=${encodeURIComponent(query)}&page_size=10`);
  const lists = await Promise.all((result.data ?? []).map((ds: any) => datasetResources(ds).catch(() => [])));
  return lists.flat();
}

// Accepte l'URL d'un jeu de données ou d'une ressource data.gouv.fr
export async function resolveUrl(url: string): Promise<Resource[]> {
  const resourceId =
    url.match(/\/datasets\/(?:[^/]+\/)?r(?:esources?)?\/([0-9a-fA-F-]{36})/)?.[1] ??
    url.match(/\/r\/([0-9a-fA-F-]{36})/)?.[1];
  if (resourceId) {
    let title = resourceId;
    let datasetTitle = '';
    try {
      const info = await getJson(`${DATAGOUV_URL}/api/2/datasets/resources/${resourceId}/`);
      title = info.resource?.title ?? title;
      if (info.dataset_id) datasetTitle = (await getJson(`${DATAGOUV_URL}/api/2/datasets/${info.dataset_id}/`)).title;
    } catch {
      /* titre facultatif */
    }
    return [{ id: resourceId, title, datasetTitle }];
  }

  const slug = url.match(/\/datasets\/([^/?#]+)/)?.[1];
  if (slug) return datasetResources(await getJson(`${DATAGOUV_URL}/api/2/datasets/${slug}/`));

  throw new Error("URL non reconnue : collez l'adresse d'un jeu de données ou d'une ressource data.gouv.fr.");
}

export interface SourceSample {
  columns: string[]; // identifiants Grist des colonnes de la ressource
  sourceNames: Record<string, string>; // identifiant Grist -> nom de la colonne dans la source
  values: Record<string, string[]>; // identifiant Grist -> valeurs distinctes de l'échantillon (pour les filtres)
  suggestedIgnore: string[]; // colonnes à ignorer par défaut pour détecter les changements
}

const looksLikeDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);

async function tabularData(resourceId: string, query: string) {
  const resp = await fetch(`${TABULAR_API}/api/resources/${resourceId}/data/?${query}`);
  if (!resp.ok) {
    throw new Error(
      resp.status === 404
        ? "Ressource absente de l'API tabulaire data.gouv (elle n'a peut-être pas encore été analysée)."
        : resp.status === 400
          ? "Filtre refusé par l'API tabulaire data.gouv : vérifiez la colonne et la valeur."
          : `Erreur de l'API tabulaire data.gouv (${resp.status}).`,
    );
  }
  return resp.json();
}

// Colonnes de la ressource, lues sur un échantillon de 200 lignes. Une colonne de date identique sur tout
// l'échantillon (ex. date_jeu_donnees) change en général à chaque publication : on propose de l'ignorer.
export async function sourceSample(resourceId: string): Promise<SourceSample> {
  const rows: any[] = (await tabularData(resourceId, 'page_size=200')).data ?? [];
  const src = Object.keys(rows[0] ?? {}).filter((k) => k !== '__id' && toGristColId(k) !== 'id');
  const suggestedIgnore = src
    .filter((k) => rows.length > 1 && looksLikeDate(rows[0][k]) && rows.every((r) => r[k] === rows[0][k]))
    .map(toGristColId);
  const values: Record<string, string[]> = {};
  for (const k of src) {
    const distinct = [...new Set(rows.map((r) => r[k]).filter((v) => v !== null && v !== '').map(String))];
    values[toGristColId(k)] = distinct.sort((a, b) => a.localeCompare(b, 'fr')).slice(0, 100);
  }
  return {
    columns: src.map(toGristColId),
    sourceNames: Object.fromEntries(src.map((k) => [toGristColId(k), k])),
    values,
    suggestedIgnore,
  };
}

// Nombre de lignes de la ressource sur data.gouv.fr, éventuellement après filtre (null si indisponible)
export async function countRows(resourceId: string, filter?: SyncFilter | null): Promise<number | null> {
  try {
    const q = filterQuery(filter);
    const result = await tabularData(resourceId, `page_size=1${q ? '&' + q : ''}`);
    return typeof result.meta?.total === 'number' ? result.meta.total : null;
  } catch {
    return null;
  }
}

// Date de dernière modification de la ressource sur data.gouv.fr (null si inconnue)
export async function resourceLastModified(resourceId: string): Promise<string | null> {
  try {
    const info = await getJson(`${DATAGOUV_URL}/api/2/datasets/resources/${resourceId}/`);
    return info.resource?.last_modified ?? null;
  } catch {
    return null;
  }
}
