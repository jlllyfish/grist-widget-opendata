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

// Colonnes de la ressource (lues sur sa première ligne), au format des identifiants Grist
export async function sourceColumns(resourceId: string): Promise<string[]> {
  const resp = await fetch(`${TABULAR_API}/api/resources/${resourceId}/data/?page_size=1`);
  if (!resp.ok) {
    throw new Error(
      resp.status === 404
        ? "Ressource absente de l'API tabulaire data.gouv (elle n'a peut-être pas encore été analysée)."
        : `Erreur de l'API tabulaire data.gouv (${resp.status}).`,
    );
  }
  const sample = await resp.json();
  return Object.keys(sample.data?.[0] ?? {})
    .filter((k) => k !== '__id')
    .map(toGristColId)
    .filter((k) => k !== 'id');
}
