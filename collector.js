/**
 * Balls49 Combined Server - STABLE VERSION
 * - Fixed ECONNRESET crashes with error listeners and agent: false
 * - Increased COLLECT_INTERVAL_MS to 10s for fast & stable updates
 * - Enhanced proxy routes for /TimeLeft and /Statistics with session cookie & browser header injection
 */
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PROXY_PORT  = 3000;
const STATIC_PORT = 8080;
const DRAWS_FILE  = path.join(__dirname, 'draws.json');
const COOKIES_FILE = path.join(__dirname, 'cookies.txt');
const MAX_DRAWS   = 1000;
const COLLECT_INTERVAL_MS = 10000;

const TARGET  = 'logigames.bet9ja.com';
const GAME_ID = 11000;

let storedDraws = [];

function loadDraws() {
  try { return JSON.parse(fs.readFileSync(DRAWS_FILE, 'utf8')); }
  catch(e) { return []; }
}
function saveDraws(draws) {
  try { fs.writeFileSync(DRAWS_FILE, JSON.stringify(draws, null, 2)); }
  catch(e) { console.error('[Collector] Failed to save draws:', e.message); }
}

function ensureCookiesFile() {
  if (!fs.existsSync(COOKIES_FILE)) {
    try { fs.writeFileSync(COOKIES_FILE, ''); }
    catch(e) { console.error(`[Collector] Failed to create cookies.txt: ${e.message}`); }
  }
}

function getCookies() {
  if (!fs.existsSync(COOKIES_FILE)) {
    console.warn(`[Collector] cookies.txt missing at ${COOKIES_FILE}.`);
    return '';
  }
  try {
    return fs.readFileSync(COOKIES_FILE, 'utf8').trim();
  } catch(e) {
    return '';
  }
}

ensureCookiesFile();
storedDraws = loadDraws();
console.log(`[Collector] Loaded ${storedDraws.length} draws.`);

// ── FAST COLLECTOR ───────────────────────────────────────────────────────────
function fetchDrawHistory(callback) {
  const body = JSON.stringify({ gameId: GAME_ID });
  const options = {
    hostname: TARGET,
    port: 443,
    path: '/Games/Balls49/DrawHistory',
    method: 'POST',
    agent: false, // Forces fresh connection to avoid stale socket resets
    headers: {
      'accept': '*/*',
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      'cookie': getCookies(),
      'origin': 'https://logigames.bet9ja.com',
      'referer': 'https://logigames.bet9ja.com/Games/Launcher?gameId=11000',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  };

  const req = https.request(options, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      if (res.statusCode !== 200) return callback(new Error('HTTP ' + res.statusCode));
      try { callback(null, JSON.parse(data)); } catch(e) { callback(e); }
    });
  });

  req.on('error', (err) => {
    console.warn('[Collector] Connection error (ECONNRESET):', err.message);
    callback(err);
  });

  req.write(body);
  req.end();
}

function collectDraws() {
  fetchDrawHistory((err, result) => {
    if (err) return;
    if (!result || !result.data || !Array.isArray(result.data.draws)) return;

    const incoming = result.data.draws;
    const knownIds = new Set(storedDraws.map(d => d.id));
    let newCount = 0;

    incoming.forEach(draw => {
      if (!knownIds.has(draw.id)) {
        const nums = (draw.dr || '').split(',').map(Number).filter(n => n >= 1 && n <= 49);
        const sum = draw.total ? parseInt(draw.total, 10) : nums.reduce((a, b) => a + b, 0);

        const colors = nums.map(n => {
          if ([1,4,7,10,13,16,19,22,25,28,31,34,37,40,43,46,49].includes(n)) return 'red';
          if ([2,5,8,11,14,17,20,23,26,29,32,35,38,41,44,47].includes(n)) return 'blue';
          return 'green';
        });

        const colorCount = { red:0, blue:0, green:0 };
        colors.forEach(c => colorCount[c]++);
        const dominantColor = Object.entries(colorCount).sort((a,b) => b[1]-a[1])[0][0];

        storedDraws.unshift({
          id: draw.id, dr: draw.dr, total: sum,
          range: sum <= 148 ? 'LOW' : (sum >= 152 ? 'HIGH' : 'MID'),
          dominantColor, colorCount, timestamp: new Date().toISOString()
        });
        newCount++;
      }
    });

    if (newCount > 0) {
      storedDraws = storedDraws.slice(0, MAX_DRAWS);
      saveDraws(storedDraws);
      console.log(`[Collector] ✅ Saved ${newCount} new draw(s). Total: ${storedDraws.length}`);
    }
  });
}

collectDraws();
setInterval(collectDraws, COLLECT_INTERVAL_MS);

// ── PROXY SERVER ─────────────────────────────────────────────────────────────
const proxyServer = http.createServer(function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Base headers required to bypass Bet9ja's security firewall
  const baseHeaders = {
    'accept': '*/*',
    'content-type': 'application/json',
    'cookie': getCookies(),
    'origin': 'https://logigames.bet9ja.com',
    'referer': 'https://logigames.bet9ja.com/Games/Launcher?gameId=11000',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'host': TARGET
  };

  // Special robust handling for TimeLeft
  if (req.url.includes('/TimeLeft')) {
    const payload = JSON.stringify({ tmp: new Date().toISOString(), pff: 1, gameId: GAME_ID });
    const options = { 
        hostname: TARGET, 
        port: 443, 
        path: '/Games/Balls49/TimeLeft', 
        method: 'POST', 
        agent: false, 
        headers: { ...baseHeaders, 'content-length': Buffer.byteLength(payload) } 
    };
    const proxyReq = https.request(options, proxyRes => {
        proxyRes.pipe(res);
    });
    proxyReq.on('error', () => { res.writeHead(502); res.end(); });
    proxyReq.write(payload);
    proxyReq.end();
    return;
  }

  // Robust proxy handling for Statistics endpoint
  if (req.url.includes('/Statistics')) {
    const options = { 
      hostname: TARGET, 
      port: 443, 
      path: '/Games/Balls49/Statistics', 
      method: 'POST', 
      agent: false, 
      // Merge original content-length with our strict headers
      headers: { ...req.headers, ...baseHeaders } 
    };
    const proxyReq = https.request(options, proxyRes => {
      proxyRes.pipe(res);
    });
    proxyReq.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(proxyReq);
    return;
  }

  // Local draws endpoint
  if (req.url === '/draws' || req.url === '/draws/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ draws: storedDraws, total: storedDraws.length }));
    return;
  }

  // Generic proxy for other requests
  const headers = { ...req.headers, ...baseHeaders };
  if (req.method === 'GET' || req.method === 'HEAD') {
    delete headers['content-length'];
    delete headers['content-type'];
  }
  const options = { hostname: TARGET, port: 443, path: req.url, method: req.method, agent: false, headers };
  const proxyReq = https.request(options, proxyRes => { proxyRes.pipe(res); });
  req.pipe(proxyReq);
  proxyReq.on('error', () => { res.writeHead(502); res.end(); });
});

proxyServer.listen(PROXY_PORT, () => console.log(`[Server] Proxy running on port ${PROXY_PORT}`));

// Serve the legacy dashboard entry point and its dedicated public asset folder only.
const STATIC_ROOT = path.resolve(__dirname);
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp'
};
const staticServer = http.createServer(function(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }

  let requestPath;
  try {
    requestPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (err) {
    res.writeHead(400);
    res.end();
    return;
  }
  const relativePath = requestPath === '/' ? 'balls49.html' : requestPath.replace(/^[/\\]+/, '');
  const filePath = path.resolve(STATIC_ROOT, relativePath);
  const assetRoot = path.resolve(STATIC_ROOT, 'balls49-assets');
  const assetPrefix = assetRoot + path.sep;
  const isDashboard = relativePath === 'balls49.html';
  const isPublicAsset = filePath.toLowerCase().startsWith(assetPrefix.toLowerCase());
  if (!isDashboard && !isPublicAsset) {
    res.writeHead(404);
    res.end();
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(err.code === 'ENOENT' ? 404 : 500); res.end(); }
    else {
      res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : data);
    }
  });
});
staticServer.listen(STATIC_PORT, () => console.log(`[Server] Dashboard running on port ${STATIC_PORT}`));
