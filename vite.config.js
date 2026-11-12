import { defineConfig } from 'vite';
// Relative base so the build works from any folder (Vercel, GitHub Pages, a plain file server).
export default defineConfig({ base: './', build: { chunkSizeWarningLimit: 900 } });
