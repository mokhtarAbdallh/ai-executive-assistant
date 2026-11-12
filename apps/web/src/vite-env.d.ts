/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" builds the offline demo (fake data, auto demo login). Never set in production. */
  readonly VITE_DEMO_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
