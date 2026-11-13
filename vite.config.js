import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
// Relative base so the build works from any folder (Vercel, GitHub Pages, a plain file server).
// FAKE_RT=1 swaps the realtime service for a same-browser stand-in (test/fake-supabase.js), for testing race rooms offline.
const fake = process.env.FAKE_RT === '1';
export default defineConfig({
  base: './', build: { chunkSizeWarningLimit: 900 },
  // which build a flight recording came from (recorder.js)
  define: { __BUILD__: JSON.stringify((process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 7) + ' ' + new Date().toISOString().slice(0, 16)) },
  resolve: fake ? { alias: { '@supabase/supabase-js': fileURLToPath(new URL('./test/fake-supabase.js', import.meta.url)) } } : {},
});
