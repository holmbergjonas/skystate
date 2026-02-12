export const env = {
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL as string,
  VITE_TEST_MODE: import.meta.env.VITE_TEST_MODE === 'true',
  VITE_TEST_GITHUB_ID: import.meta.env.VITE_TEST_GITHUB_ID as string | undefined,
  VITE_TEST_EMAIL: import.meta.env.VITE_TEST_EMAIL as string | undefined,
  VITE_TEST_NAME: import.meta.env.VITE_TEST_NAME as string | undefined,
} as const;
