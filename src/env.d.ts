/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VUE_APP_DATAGOUV_IMPORT_URL?: string;
  readonly VUE_APP_DATAGOUV_TABULAR_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
