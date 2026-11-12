import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
// Relative base so the build works from any folder (Vercel, GitHub Pages, a plain file server).
// FAKE_RT=1 swaps the realtime service for a same-browser stand-in (test/fake-supabase.js), for testing race rooms offline.
const fake = process.env.FAKE_RT === '1';
export default defineConfig({
  base: './', build: { chunkSizeWarningLimit: 900 },
  resolve: fake ? { alias: { '@supabase/supabase-js': fileURLToPath(new URL('./test/fake-supabase.js', import.meta.url)) } } : {},
});
