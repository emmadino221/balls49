import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env,
  VITE_HISTORY_API_URL: '/api/public-history',
  VITE_CLOCK_API_URL: '/api/public-clock',
  VITE_LIVE_PREDICTION_API_URL: '/api/public-current-prediction',
};
for (const args of [['node_modules/vite/bin/vite.js', 'build'], ['scripts/create-route-pages.mjs']]) {
  const result = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
