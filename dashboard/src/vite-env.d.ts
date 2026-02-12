/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_TEST_MODE: string;
  readonly VITE_TEST_GITHUB_ID?: string;
  readonly VITE_TEST_EMAIL?: string;
  readonly VITE_TEST_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
