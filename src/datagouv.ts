// Recherche de ressources tabulaires sur data.gouv.fr (API publique, sans authentification).
import { TABULAR_API, toGristColId } from './sync';

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
  suggestedIgnore: string[]; // colonnes à ignorer par défaut pour détecter les changements
}

const looksLikeDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);

// Colonnes de la ressource, lues sur un échantillon de 200 lignes. Une colonne de date identique sur tout
// l'échantillon (ex. date_jeu_donnees) change en général à chaque publication : on propose de l'ignorer.
export async function sourceSample(resourceId: string): Promise<SourceSample> {
  const resp = await fetch(`${TABULAR_API}/api/resources/${resourceId}/data/?page_size=200`);
  if (!resp.ok) {
    throw new Error(
      resp.status === 404
        ? "Ressource absente de l'API tabulaire data.gouv (elle n'a peut-être pas encore été analysée)."
        : `Erreur de l'API tabulaire data.gouv (${resp.status}).`,
    );
  }
  const rows: any[] = (await resp.json()).data ?? [];
  const src = Object.keys(rows[0] ?? {}).filter((k) => k !== '__id' && toGristColId(k) !== 'id');
  const suggestedIgnore = src
    .filter((k) => rows.length > 1 && looksLikeDate(rows[0][k]) && rows.every((r) => r[k] === rows[0][k]))
    .map(toGristColId);
  return { columns: src.map(toGristColId), suggestedIgnore };
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
