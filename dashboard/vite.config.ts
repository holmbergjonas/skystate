import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react-swc"
import { defineConfig } from "vite"

export default defineConfig(({ mode }) => {
  const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:5148';

  return {
    plugins: [react(), tailwindcss()],
    envDir: mode === 'development' ? undefined : '.',
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test-setup.ts'],
      include: ['test/unit/**/*.test.{ts,tsx}'],
    },
    server: {
      host: '0.0.0.0',
      allowedHosts: true,
      hmr: {
        clientPort: 8080,
      },
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
        '/auth': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});