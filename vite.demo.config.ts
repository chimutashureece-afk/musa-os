// Builds a single self-contained HTML file of the demo (used for the shareable preview).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  envDir: 'demo-env', // no Firebase keys here, so the shareable preview always stays in demo mode
  build: { outDir: 'dist-demo', chunkSizeWarningLimit: 10000 },
});
