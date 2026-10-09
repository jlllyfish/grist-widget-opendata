<template>

    <div v-if="currentStep === 'selectTable'">
    <!-- 1/ cette page est celle qui est affichée pour choisir quelle table Grist utiliser -->
        <fieldset class="fr-fieldset">
            <legend class="fr-fieldset__legend--regular fr-fieldset__legend">Mode d'import</legend>
            <div class="fr-fieldset__element">
                <div class="fr-radio-group">
                    <input type="radio" id="mode-replace" value="replace" v-model="importMode">
                    <label class="fr-label" for="mode-replace">Remplacer tout le contenu de la table</label>
                </div>
            </div>
            <div class="fr-fieldset__element">
                <div class="fr-radio-group">
                    <input type="radio" id="mode-upsert" value="upsert" v-model="importMode">
                    <label class="fr-label" for="mode-upsert">
                        Mettre à jour (upsert)
                        <span class="fr-hint-text">Les lignes sont rapprochées par une clé ; la colonne {{ MAJ_COL }} indique la date de dernière modification.</span>
                    </label>
                </div>
            </div>
        </fieldset>
        <legend class="fr-fieldset__legend--regular fr-fieldset__legend" id="radio-hint-legend">
            Sélectionnez la table que vous voulez utiliser.
            <span v-if="importMode === 'replace'" class="fr-hint-text">Attention, toute donnée de cette table sera supprimée</span>
        </legend>
        <div v-for="item in activeGristTables" v-bind:key="item">
            <div class="fr-fieldset__element">
                <div class="fr-radio-group">
                    <input type="radio" :id="item" :name="item" :value="item" v-model="selectedTable">
                    <label class="fr-label" :for="item">
                        {{ item }}
                    </label>
                </div>
            </div>
        </div>
    </div>

    <div v-if="currentStep === 'selectOrganization'">
    <!-- 2/ cette page est celle qui est affichée quand on propose à l'utilisateur de choisir dans quelle organisation dgv rechercher la donnée.
     Si l'utilisateur n'a pas d'organisation, cette étape est sautée. -->
        <div v-if="profile && profile.organizations && profile.organizations.length > 0">
            <p>À quelle organisation appartient le jeu de données que vous souhaitez importer dans Grist ?</p>
            <div v-for="item in profile.organizations" v-bind:key="item.id">
                <div @click="selectOrganization(item.id, item.logo_thumbnail)" class="fr-tile fr-tile--sm fr-tile--horizontal fr-enlarge-link" id="tile-6661">
                    <div class="fr-tile__body">
                        <div class="fr-tile__content">
                            <h3 class="fr-tile__title">
                                <a href="#">{{ item.name }}</a>
                            </h3>
                        </div>
                    </div>
                    <div class="fr-tile__header">
                        <div class="fr-tile__pictogram">
                            <img :src="item.logo_thumbnail" />
                        </div>
                    </div>
                </div>
                <br />
            </div>
        </div>
        <div @click="selectOrganization(null, null)" class="fr-tile fr-tile--sm fr-tile--horizontal fr-enlarge-link" id="tile-6661">
            <div class="fr-tile__body">
                <div class="fr-tile__content">
                    <h3 class="fr-tile__title">
                        <a href="#">Récupérer des données qui ne sont pas dans mes organisations</a>
                    </h3>
                </div>
            </div>
        </div>
    </div>

    <p v-if="urlError" class="fr-error-text">{{ urlError }}</p>
    <div v-if="currentStep === 'searchDataset'">
    <!-- 3/ cette page est celle qui est affichée pour rechercher un jeu de données -->
        <div v-if="showInputSearch">
            <label class="fr-label" for="text-input-text">Rechercher un jeu de données</label>
            <input class="fr-input" type="text" id="text-input-text" name="text-input-text" v-model="searchText" @input="searchDatagouv()">
            <br />
            <label class="fr-label" for="text-input-url">Coller une URL data.gouv.fr (jeu de données ou ressource)</label>
            <div class="fr-input-group">
              <input class="fr-input" type="url" id="text-input-url" name="text-input-url" v-model="pastedUrl" placeholder="https://www.data.gouv.fr/fr/datasets/... ou .../r/{resource-id}">
            </div>
            <div class="fr-mt-2w">
              <button class="fr-btn" @click="submitUrl" :disabled="isSubmittingUrl || pastedUrl.trim() === ''">Importer depuis l'URL</button>
            </div>
            <br />
        </div>
        <div v-for="resource in resources" v-bind:key="resource.resource_id">
            <div @click="importResource(resource.resource_id)" class="fr-tile fr-tile--sm fr-tile--horizontal fr-enlarge-link" id="tile-6661">
                <div class="fr-tile__body">
                    <div class="fr-tile__content">
                        <h3 class="fr-tile__title">
                            <a href="#">{{ resource.dataset_title }}</a>
                        </h3>
                        <p class="fr-tile__detail">{{ resource.resource_title }}<span v-if="resource.organization_name">&nbsp;— <strong>{{ resource.organization_name }}</strong></span></p>
                    </div>
                </div>
            </div>
            <br />
        </div>
    </div>

    <div v-if="currentStep === 'selectKey'">
    <!-- 3bis/ mode upsert : choix de la ou des colonnes servant de clé de rapprochement -->
        <fieldset class="fr-fieldset">
            <legend class="fr-fieldset__legend--regular fr-fieldset__legend">Comment reconnaître une ligne d'un import à l'autre ?</legend>
            <div class="fr-fieldset__element">
                <div class="fr-radio-group">
                    <input type="radio" id="keymode-columns" value="columns" v-model="keyMode">
                    <label class="fr-label" for="keymode-columns">Par une ou plusieurs colonnes de la source</label>
                </div>
            </div>
            <div class="fr-fieldset__element">
                <div class="fr-radio-group">
                    <input type="radio" id="keymode-hash" value="hash" v-model="keyMode">
                    <label class="fr-label" for="keymode-hash">
                        La source n'a pas d'identifiant : générer une clé
                        <span class="fr-hint-text">Une empreinte du contenu de chaque ligne est stockée dans {{ HASH_COL }}. Une ligne modifiée dans la source est remplacée par une nouvelle ligne, et les lignes disparues sont supprimées.</span>
                    </label>
                </div>
            </div>
        </fieldset>
        <fieldset v-if="keyMode === 'columns'" class="fr-fieldset">
            <legend class="fr-fieldset__legend--regular fr-fieldset__legend">
                Colonne(s) identifiant de manière unique une ligne
                <span class="fr-hint-text">Ex. : SIRET, code INSEE, identifiant d'établissement. Cochez plusieurs colonnes si c'est leur combinaison qui est unique.</span>
            </legend>
            <div v-for="col in availableColumns" :key="col" class="fr-fieldset__element">
                <div class="fr-checkbox-group">
                    <input type="checkbox" :id="'key-' + col" :value="col" v-model="keyColumns">
                    <label class="fr-label" :for="'key-' + col">{{ col }}</label>
                </div>
            </div>
        </fieldset>
        <div v-if="keyMode === 'columns'" class="fr-checkbox-group fr-mb-2w">
            <input type="checkbox" id="delete-missing" v-model="deleteMissing">
            <label class="fr-label" for="delete-missing">Supprimer les lignes de la table absentes de la source</label>
        </div>
        <button class="fr-btn" :disabled="keyMode === 'columns' && keyColumns.length === 0" @click="confirmUpsert">Lancer la mise à jour</button>
    </div>

    <div>
    <!-- 4/ cette page est celle qui est affichée quand l'import est en cours -->
        <div v-if="currentStep === 'loading'" class="fr-stepper">
            <h2 class="fr-stepper__title">
                En cours d'importation dans la table {{ selectedTable }}
            </h2>
            <div class="fr-stepper__steps" :data-fr-current-step="ongoingStep" data-fr-steps="8"></div>
        </div>
    </div>

    <div v-if="!showLoader && isImported">
    <!-- 5/ cette page est celle qui est affichée quand l'import est terminé -->
        <br />
        🎉 Données importées dans la table {{ selectedTable }}
        <p v-if="upsertStats" class="fr-text--sm fr-mt-1w">
            {{ upsertStats.rows }} lignes source traitées<span v-if="upsertStats.removed !== null">, {{ upsertStats.removed }} lignes supprimées</span>.
            <span v-if="upsertStats.truncated"> Import limité à {{ MAX_PAGES }} pages : suppression des lignes absentes non effectuée.</span>
        </p>
        <div v-if="configSaved" class="fr-alert fr-alert--info fr-alert--sm fr-mt-2w">
            <p>Pour mémoriser cette synchronisation, cliquez sur <strong>Enregistrer</strong> en haut du widget (une seule fois). Ensuite, le bouton « Mettre à jour » de l'accueil suffit.</p>
        </div>
        <button class="fr-btn fr-btn--secondary fr-btn--icon-left fr-icon-arrow-left-line fr-mt-2w" @click="goHome">Retour à l'accueil</button>
    </div>


</template>


<script lang="ts">
import { defineComponent, computed, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import { processString } from '@/utils';
import { MAJ_COL, HASH_COL, MAX_PAGES, toGristColId, runSync, saveSyncIfChanged, type KeyMode, type SyncConfig, type SyncStats } from './sync';


interface Resource {
  dataset_id: any;
  dataset_title: any;
  resource_id: any;
  resource_title: any;
  organization_name?: any;
}

function debounce<T extends () => void>(fn: T, delay: number): () => void {
  let timeoutID: number;
  return () => {
    clearTimeout(timeoutID);
    timeoutID = window.setTimeout(() => fn(), delay);
  };
}

export default defineComponent({
  name: 'ImporterForm',
  components: { },
  setup() {
    const store = useStore();
    const showInputSearch = ref(true)
    const logoSelectedOrg = ref("")
    const showDatasetSelector = ref(false)
    const searchText = ref("")
    const pastedUrl = ref("")
    const urlError = ref("")
    const isSubmittingUrl = ref(false)
    const resources = ref<Resource[]>([]);
    const selectedTable = ref("")
    const ongoingStep = ref(0)
    const nbPages = ref(0)
    const showLoader = ref(false)
    const isImported = ref(false)
    const importMode = ref<"replace" | "upsert">("replace")
    const pendingResourceId = ref<string | null>(null)
    const availableColumns = ref<string[]>([])
    const keyColumns = ref<string[]>([])
    const keyMode = ref<KeyMode>("columns")
    const pendingResourceTitle = ref("")
    const deleteMissing = ref(false)
    const upsertStats = ref<SyncStats | null>(null)
    const configSaved = ref(false)
    const goHome = () => store.dispatch('updateMenuOption', null)
    const datagouvUrl = import.meta.env.VUE_APP_DATAGOUV_IMPORT_URL
    const tabularapiUrl = import.meta.env.VUE_APP_DATAGOUV_TABULAR_API
    let gristUrl = ""

    window.grist.getAccessToken().then(res => {
    try {
        gristUrl = res.baseUrl.split("/o/")[0];
    } catch {
        gristUrl = import.meta.env.VUE_APP_GRIST_URL || '';
    }
    }).catch(() => {
        gristUrl = import.meta.env.VUE_APP_GRIST_URL || '';
    });


    const getDatasetsOrg = async (org: string) => {
        const response = await fetch(datagouvUrl + "/api/1/datasets/?organization=" + org);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        console.log(data.data)
        resources.value = []
        data.data.forEach((dataset: { resources: any[]; id: any; title: any; organization?: { name?: string } }) => {
            dataset.resources.forEach((resource) => {
                if (resource.extras && resource.extras["analysis:parsing:finished_at"]) {
                    resources.value.push({
                        "dataset_id": dataset.id,
                        "dataset_title": dataset.title,
                        "resource_id": resource.id,
                        "resource_title": resource.title,
                        "organization_name": dataset.organization?.name,
                    });
                }
            })
        })
        console.log(data.data)
    }

    const selectOrganization = async (org: string|null, logo: string|null) => {
        showDatasetSelector.value = true;
        if (org){
            logoSelectedOrg.value = logo ?? ''
            showInputSearch.value = false;
            await getDatasetsOrg(org);
        }
    }

    const searchDatagouv = async () => {
      try {
        const response = await fetch(datagouvUrl + "/api/2/datasets/search/?q=" + searchText.value, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          }
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json();
        resources.value = []
        result.data.forEach(async (dataset: { resources: { href: string; }; id: any; title: any; organization?: { name?: string } }) => {
          const response2 = await fetch(dataset.resources.href, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
              }
            });
            if (!response2.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            const result2 = await response2.json();
            result2.data.forEach((resource: { id: any; title: any; extras: any;}) => {
              if (resource.extras && resource.extras["analysis:parsing:finished_at"]) {
                resources.value.push({
                  "dataset_id": dataset.id,
                  "dataset_title": dataset.title,
                  "resource_id": resource.id,
                  "resource_title": resource.title,
                  "organization_name": dataset.organization?.name,
                });
              }
            });
          })
      } catch (error) {
        console.error("Error datagouv search", error);
        throw error;
      }
    }

    const debouncedSearch = debounce(searchDatagouv, 500);


    const submitUrl = async () => {
        urlError.value = "";
        const url = pastedUrl.value.trim();
        if (url === "") {
            urlError.value = "URL manquante.";
            return;
        }
        try {
            isSubmittingUrl.value = true;
            // Supporte: /fr/datasets/r/{resourceId} ou /datasets/{slug}/resource/{resourceId}
            // et /fr/datasets/{slug}
            const resourceMatch = url.match(/\/datasets\/(?:[^/]+\/)?r(?:esource)?\/?([0-9a-fA-F-]{36})/);
            const directResourceMatch = url.match(/\/r\/([0-9a-fA-F-]{36})/);
            const datasetSlugMatch = url.match(/\/datasets\/([^/?#]+)(?:[/?#]|$)/);

            const resourceId = (resourceMatch && resourceMatch[1]) || (directResourceMatch && directResourceMatch[1]);
            if (resourceId) {
                await importResource(resourceId);
                return;
            }

            if (datasetSlugMatch && datasetSlugMatch[1]) {
                const slug = datasetSlugMatch[1];
                const resp = await fetch(`${datagouvUrl}/api/2/datasets/${slug}`);
                if (!resp.ok) {
                    throw new Error(`Impossible de récupérer le jeu de données (${resp.status}).`);
                }
                const ds = await resp.json();
                // Récupère les ressources via le lien fourni par l'API v2
                const resResp = await fetch(ds.resources.href, { headers: { 'Content-Type': 'application/json' } });
                if (!resResp.ok) {
                    throw new Error(`Impossible de lister les ressources (${resResp.status}).`);
                }
                const resJson = await resResp.json();
                resources.value = [];
                resJson.data.forEach((resource: { id: any; title: any; extras: any; }) => {
                    if (resource.extras && resource.extras["analysis:parsing:finished_at"]) {
                        resources.value.push({
                            dataset_id: ds.id,
                            dataset_title: ds.title,
                            resource_id: resource.id,
                            resource_title: resource.title,
                        });
                    }
                });
                if (resources.value.length === 0) {
                    urlError.value = "Aucune ressource tabulaire détectée pour ce jeu de données.";
                } else {
                    showDatasetSelector.value = true;
                    showInputSearch.value = false;
                }
                return;
            }

            urlError.value = "URL non reconnue. Collez l'URL d'un jeu de données ou d'une ressource data.gouv.fr.";
        } catch (e: any) {
            console.error(e);
            urlError.value = e?.message || "Erreur lors du traitement de l'URL.";
        } finally {
            isSubmittingUrl.value = false;
        }
    }

    const importResource = async (id: string) => {
        urlError.value = "";
        ongoingStep.value = 1
        showLoader.value = true;

        // Vérifie d'abord que la ressource est accessible via l'API tabulaire
        try {
            const probe = await fetch(`${tabularapiUrl}/api/resources/${id}/data/?page_size=1`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            if (!probe.ok) {
                showLoader.value = false;
                isImported.value = false;
                urlError.value = probe.status === 404
                    ? "Ressource introuvable dans l'API tabulaire (404). Vérifiez l'ID ou que la ressource est tabularisée/publique."
                    : `Erreur lors de l'accès à l'API tabulaire (${probe.status}).`;
                return;
            }
            if (importMode.value === "upsert") {
                // On s'arrête ici pour faire choisir la clé ; l'import reprend dans confirmUpsert()
                const sample = await probe.json();
                availableColumns.value = Object.keys(sample.data?.[0] ?? {})
                    .filter((k) => k !== "__id")
                    .map(toGristColId)
                    .filter((k) => k !== "id");
                keyColumns.value = [];
                const r = resources.value.find((x) => x.resource_id === id);
                pendingResourceTitle.value = r ? `${r.dataset_title} — ${r.resource_title}` : id;
                pendingResourceId.value = id;
                showLoader.value = false;
                return;
            }
        } catch (e: any) {
            showLoader.value = false;
            isImported.value = false;
            urlError.value = e?.message || "Erreur réseau lors de la vérification de la ressource.";
            return;
        }

        const tokenInfo = await window.grist.docApi.getAccessToken({readOnly: true});
        const ress = await fetch(gristUrl + "/api/docs/" + store.state.docId + "/tables/" + selectedTable.value + "/records?auth=" + tokenInfo.token, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        }
        });
        if (!ress.ok) {
        throw new Error(`HTTP error! status: ${ress.status}`);
        }
        const records = await ress.json();
        const recordsToRemove: any[] = []
        records.records.forEach((r: any) => {
            recordsToRemove.push(r.id)
        })


        let res = await window.grist.docApi.fetchTable(selectedTable.value);

        for (const key of Object.keys(res)) {
          if (!["id", "manualSort"].includes(key)) {
            await window.grist.docApi.applyUserActions([['RemoveColumn', selectedTable.value, key]]);
          }
        }
        await window.grist.docApi.applyUserActions([['BulkRemoveRecord', selectedTable.value, recordsToRemove]]);
        ongoingStep.value = 2

        res = await fetch(`${tabularapiUrl}/api/resources/${id}/data/?page_size=200`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });
        if (!res.ok) {
          showLoader.value = false;
          isImported.value = false;
          urlError.value = res.status === 404 ? "Ressource introuvable dans l'API tabulaire (404). Vérifiez l'ID ou que la ressource est tabularisée/publique." : `Erreur API tabulaire (${res.status}).`;
          return;
        }
        const result = await res.json();
        nbPages.value = Math.ceil(result.meta.total / result.meta.page_size) - 1;
        if (nbPages.value > 50){
            nbPages.value = 50
        }

        const resss = await fetch(gristUrl + "/api/docs/" + store.state.docId + "/tables/?auth=" + tokenInfo.token, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        }
        });
        if (!resss.ok) {
        throw new Error(`HTTP error! status: ${resss.status}`);
        }
        const tables = await resss.json();
        let parentId = 1

        tables.tables.forEach((table: {id: string, fields: { rawViewSectionRef: number }}) => {
            if (table.id === selectedTable.value){
                parentId = table.fields.rawViewSectionRef - 1 // long analysis of the logs and many tests to find that
            }
        })

        for (const key of Object.keys(result.data[0])) {
            if (key !== "__id") {
                const processedKey = processString(key);
                const ress = await window.grist.docApi.applyUserActions([['AddColumn', selectedTable.value, processedKey, { isFormula: true, type: 'Any', formula: '' }]]);
                await window.grist.docApi.applyUserActions([['AddRecord', "_grist_Views_section_field", null, { parentPos: null, parentId: parentId, colRef: ress.retValues[0].colRef }]]);
            }
        }
        ongoingStep.value = 3

        for (let i = 0; i <= nbPages.value; i++) {
            const calculus = Math.floor((((((i+1) * 100) / nbPages.value) * 5) / 100) + 3)
            if (Number.isFinite(calculus)) {
                ongoingStep.value = calculus
            } else {
                ongoingStep.value = 8
            }
            //ongoingStep.value = Math.floor((((((i+1) * 100) / nbPages.value) * 5) / 100) + 3)

            const response2 = await fetch(`${tabularapiUrl}/api/resources/${id}/data/?page_size=200&page=${i}`);
            if (!response2.ok) {
            throw new Error(`HTTP error! status: ${response2.status}`);
            }
            const result2 = await response2.json();
            const arr: any = {};
            result2.data.forEach((item: any) => {
                for (const key of Object.keys(item)) {
                    const processedKey = processString(key);
                    if (processedKey != "id"){
                        if (!arr[processedKey]) {
                            arr[processedKey] = [];
                        }
                        arr[processedKey].push(String(item[key]));
                    }
                }
            });

            console.log("arr", arr)

            const nullArray = new Array(arr[Object.keys(arr)[0]].length).fill(null);
            try {
                const records = [["BulkAddRecord", selectedTable.value, nullArray, arr]];
                await window.grist.docApi.applyUserActions(records);
            } catch (e: any) {
                showLoader.value = false;
                isImported.value = false;
                urlError.value = e?.message || "Erreur lors de l'insertion des données (BulkAddRecord).";
                return;
            }

        }
        showLoader.value = false
        isImported.value = true
    };

    const runUpsert = async (id: string) => {
        urlError.value = "";
        upsertStats.value = null;
        showLoader.value = true;
        try {
            const cfg: SyncConfig = {
                table: selectedTable.value,
                resourceId: id,
                resourceTitle: pendingResourceTitle.value,
                keyMode: keyMode.value,
                keys: [...keyColumns.value],
                deleteMissing: deleteMissing.value,
            };
            upsertStats.value = await runSync(cfg, (step) => { ongoingStep.value = step; });
            configSaved.value = await saveSyncIfChanged(cfg);
            isImported.value = true;
        } catch (e: any) {
            console.error(e);
            urlError.value = e?.message || "Erreur lors de la mise à jour (BulkAddOrUpdateRecord).";
        } finally {
            showLoader.value = false;
        }
    };

    const confirmUpsert = async () => {
        const id = pendingResourceId.value;
        if (!id) return;
        pendingResourceId.value = null;
        await runUpsert(id);
    };

    const getActiveGristTables = async () => {
      const activeGristTables = await window.grist.docApi.listTables();
      store.dispatch('updateActiveGristTables', activeGristTables);
      const docId = await window.grist.docApi.getDocName();
      store.dispatch('updateDocId', docId);
    }

    onMounted(async () => {
        getActiveGristTables()
    });

    const profile = computed(() => store.state.profile);

    const currentStep = computed(() => {
      // In reverted order so that later steps have precedence
      if (isImported.value) return "imported";
      if (showLoader.value) return "loading";
      if (pendingResourceId.value) return "selectKey";
      if (showDatasetSelector.value) return "searchDataset";
      if (selectedTable.value !== "") {
        const hasOrganizations = profile.value?.organizations?.length > 0;
        return hasOrganizations ? "selectOrganization" : "searchDataset";
      }

      return "selectTable";
    });

    return {
        profile,
        currentStep,
        selectOrganization,
        showInputSearch,
        pastedUrl,
        urlError,
        isSubmittingUrl,
        submitUrl,
        logoSelectedOrg,
        showDatasetSelector,
        searchText,
        searchDatagouv: debouncedSearch,
        resources,
        importResource,
        selectedTable,
        activeGristTables: computed(() => store.state.activeGristTables),
        ongoingStep,
        nbPages,
        showLoader,
        isImported,
        importMode,
        availableColumns,
        keyColumns,
        keyMode,
        HASH_COL,
        deleteMissing,
        confirmUpsert,
        upsertStats,
        configSaved,
        goHome,
        MAJ_COL,
        MAX_PAGES,
    }

  }
});
</script>

<style scoped>
.fr-error-text{
  margin-bottom: 1rem;
  display: block;
}
</style>
