'use strict';

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHANNEL_CHAT_ID = process.env.TELEGRAM_CHANNEL_ID || '';
if (!TOKEN) console.warn('[WARNING] TELEGRAM_BOT_TOKEN is not set; Telegram features are disabled.');
if (TOKEN && !CHANNEL_CHAT_ID) console.warn('[WARNING] TELEGRAM_CHANNEL_ID is not set; prediction broadcasts are disabled.');

const GAME_ID = 11000;
const BTC_NUM = 11090; 
const BTC_TC  = 11120;
const POLL_SEC = 5;

const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_URL || '';
const SESSION_STATE_FILE = path.join(__dirname, 'session_state.json');
const SITE_USERS_FILE = path.join(__dirname, 'site_users.json');
const SITE_DATABASE_FILE = path.resolve(process.env.SITE_DB_PATH || path.join(__dirname, 'site_users.sqlite'));
const SITE_ADMIN_KEY = process.env.SITE_ADMIN_KEY || '';
fs.mkdirSync(path.dirname(SITE_DATABASE_FILE), { recursive: true });
const siteDb = new DatabaseSync(SITE_DATABASE_FILE);
siteDb.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS site_users (
        email TEXT PRIMARY KEY,
        user_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS site_sessions (
        token_hash TEXT PRIMARY KEY,
        session_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS site_sessions_expiry_idx ON site_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS public_prediction_feed (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        current_json TEXT,
        clock_json TEXT NOT NULL,
        history_json TEXT NOT NULL,
        history_hash TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS public_prediction_history (
        draw_id TEXT PRIMARY KEY,
        sort_draw_id INTEGER NOT NULL,
        record_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS public_prediction_history_sort_idx ON public_prediction_history(sort_draw_id DESC);
    CREATE TABLE IF NOT EXISTS site_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL
    );
`);
function migrateLegacySiteUsers() {
    const userCount = siteDb.prepare('SELECT COUNT(*) AS count FROM site_users').get().count;
    if (userCount > 0 || !fs.existsSync(SITE_USERS_FILE)) return;
    const legacyUsers = JSON.parse(fs.readFileSync(SITE_USERS_FILE, 'utf8'));
    if (!legacyUsers || typeof legacyUsers !== 'object' || Array.isArray(legacyUsers)) {
        throw new Error('site_users.json has an invalid format; it was left unchanged and was not imported.');
    }
    const insertUser = siteDb.prepare('INSERT INTO site_users(email, user_json) VALUES (?, ?)');
    siteDb.exec('BEGIN IMMEDIATE');
    try {
        for (const [email, user] of Object.entries(legacyUsers)) {
            if (!/^\S+@\S+\.\S+$/.test(email) || !user || typeof user !== 'object' || user.email !== email) {
                throw new Error('site_users.json contains an invalid account record; it was left unchanged and was not imported.');
            }
            insertUser.run(email, JSON.stringify(user));
        }
        siteDb.exec('COMMIT');
        if (Object.keys(legacyUsers).length) console.log(`[SiteAuth] Imported ${Object.keys(legacyUsers).length} existing account(s) into SQLite.`);
    } catch (error) {
        siteDb.exec('ROLLBACK');
        throw error;
    }
}
migrateLegacySiteUsers();
const getSiteUserStatement = siteDb.prepare('SELECT user_json FROM site_users WHERE email = ?');
const listSiteUsersStatement = siteDb.prepare('SELECT user_json FROM site_users ORDER BY email');
const saveSiteUserStatement = siteDb.prepare(`
    INSERT INTO site_users(email, user_json) VALUES (?, ?)
    ON CONFLICT(email) DO UPDATE SET user_json = excluded.user_json
`);
const createSiteUserStatement = siteDb.prepare('INSERT INTO site_users(email, user_json) VALUES (?, ?)');
const getPublicPredictionFeedStatement = siteDb.prepare('SELECT * FROM public_prediction_feed WHERE id = 1');
const getSiteSettingStatement = siteDb.prepare('SELECT setting_value FROM site_settings WHERE setting_key = ?');
const setSiteSettingStatement = siteDb.prepare(`
    INSERT INTO site_settings(setting_key, setting_value) VALUES (?, ?)
    ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value
`);
const listPublicPredictionHistoryStatement = siteDb.prepare('SELECT record_json FROM public_prediction_history ORDER BY sort_draw_id DESC, draw_id DESC');
const upsertPublicPredictionHistoryStatement = siteDb.prepare(`
    INSERT INTO public_prediction_history(draw_id, sort_draw_id, record_json) VALUES (?, ?, ?)
    ON CONFLICT(draw_id) DO UPDATE SET sort_draw_id = excluded.sort_draw_id, record_json = excluded.record_json
`);
const savePublicPredictionFeedStatement = siteDb.prepare(`
    INSERT INTO public_prediction_feed(id, current_json, clock_json, history_json, history_hash, updated_at)
    VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
        current_json = excluded.current_json,
        clock_json = excluded.clock_json,
        history_json = excluded.history_json,
        history_hash = excluded.history_hash,
        updated_at = excluded.updated_at
`);
const siteSessions = {
    create(token, session) {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        siteDb.prepare('INSERT OR REPLACE INTO site_sessions(token_hash, session_json, expires_at) VALUES (?, ?, ?)')
            .run(tokenHash, JSON.stringify(session), session.expiresAt);
    },
    get(token) {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const row = siteDb.prepare('SELECT session_json, expires_at FROM site_sessions WHERE token_hash = ?').get(tokenHash);
        if (!row) return null;
        if (row.expires_at <= Date.now()) {
            siteDb.prepare('DELETE FROM site_sessions WHERE token_hash = ?').run(tokenHash);
            return null;
        }
        return JSON.parse(row.session_json);
    },
    update(token, session) {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        siteDb.prepare('UPDATE site_sessions SET session_json = ?, expires_at = ? WHERE token_hash = ?')
            .run(JSON.stringify(session), session.expiresAt, tokenHash);
    },
    delete(token) {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        siteDb.prepare('DELETE FROM site_sessions WHERE token_hash = ?').run(tokenHash);
    }
};
siteDb.prepare('DELETE FROM site_sessions WHERE expires_at <= ?').run(Date.now());
const siteAuthRateLimits = new Map();
const siteMarkets = ['betzero', 'bet49', 'rainbow', 'totalColor', 'totalColor2', 'hilo', 'unified'];
// Public hosting should expose only the account and read-only website API routes.
const SITE_PUBLIC_MODE = process.env.SITE_PUBLIC_MODE === 'true';
const PORT = Number.parseInt(process.env.PORT || '3001', 10) || 3001;
const PREDICTION_INGEST_URL = process.env.PREDICTION_INGEST_URL || '';
const PREDICTION_INGEST_SECRET = process.env.PREDICTION_INGEST_SECRET || '';
if (SITE_PUBLIC_MODE && Buffer.byteLength(PREDICTION_INGEST_SECRET) < 32) {
    throw new Error('PREDICTION_INGEST_SECRET must be at least 32 bytes in public mode.');
}
if (!SITE_PUBLIC_MODE && PREDICTION_INGEST_URL && Buffer.byteLength(PREDICTION_INGEST_SECRET) < 32) {
    throw new Error('PREDICTION_INGEST_SECRET must be at least 32 bytes when prediction publishing is enabled.');
}
if (!SITE_PUBLIC_MODE && PREDICTION_INGEST_URL) {
    const ingestUrl = new URL(PREDICTION_INGEST_URL);
    if (ingestUrl.protocol !== 'https:' || ingestUrl.username || ingestUrl.password || ingestUrl.search || ingestUrl.hash) {
        throw new Error('PREDICTION_INGEST_URL must be an HTTPS URL without credentials, query, or fragment.');
    }
}
const SITE_ALLOWED_ORIGINS = new Set((process.env.SITE_ALLOWED_ORIGINS || (SITE_PUBLIC_MODE ? '' : 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173,https://logigames.bet9ja.com'))
    .split(',').map(origin => origin.trim()).filter(Boolean));
if (SITE_PUBLIC_MODE && SITE_ALLOWED_ORIGINS.size === 0) {
    throw new Error('SITE_ALLOWED_ORIGINS must contain the deployed website origin when SITE_PUBLIC_MODE=true.');
}
const PUBLIC_SITE_ROUTES = new Set([
    'GET /public-history', 'GET /public-current-prediction', 'GET /public-clock',
    'POST /internal/prediction-snapshot',
    'POST /auth/signup', 'POST /auth/login', 'GET /auth/me', 'POST /auth/logout',
    'GET /account/stake-plans', 'POST /account/stake-plan',
    'POST /admin/session', 'GET /admin/users', 'POST /admin/approve', 'POST /admin/reset-market-stats',
    'GET /admin/preview', 'POST /admin/preview', 'POST /admin/logout'
]);

function isAllowedApiOrigin(origin) {
    return SITE_ALLOWED_ORIGINS.has(origin)
        || (!SITE_PUBLIC_MODE && /^chrome-extension:\/\/[a-p]{32}$/.test(origin));
}

function saveSiteUser(user) {
    saveSiteUserStatement.run(user.email, JSON.stringify(user));
}
function createSiteUser(user) {
    createSiteUserStatement.run(user.email, JSON.stringify(user));
}
function getSiteUser(email) {
    const row = getSiteUserStatement.get(email);
    return row ? JSON.parse(row.user_json) : null;
}
function getSiteUsers() {
    return listSiteUsersStatement.all().map(row => JSON.parse(row.user_json));
}
function sendJson(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
}
function readRequestJson(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; if (body.length > 16384) req.destroy(); });
        req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (error) { reject(error); } });
        req.on('error', reject);
    });
}
function readRequestText(req, maxBytes) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let totalBytes = 0;
        let tooLarge = false;
        req.on('data', chunk => {
            totalBytes += chunk.length;
            if (totalBytes > maxBytes) {
                tooLarge = true;
                req.destroy();
                reject(new Error('Request body too large.'));
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (!tooLarge) resolve(Buffer.concat(chunks).toString('utf8'));
        });
        req.on('error', error => { if (!tooLarge) reject(error); });
    });
}
function sessionToken(req) {
    const cookies = String(req.headers.cookie || '').split(';');
    const sessionCookie = cookies.find(cookie => cookie.trim().startsWith('balls49_session='));
    if (sessionCookie) {
        try { return decodeURIComponent(sessionCookie.trim().slice('balls49_session='.length)); }
        catch { return ''; }
    }
    // Bearer compatibility is restricted to local development; public sessions stay HttpOnly.
    if (!SITE_PUBLIC_MODE) return /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1] || '';
    return '';
}
function siteSession(req) {
    const token = sessionToken(req);
    const session = token && siteSessions.get(token);
    if (!session || session.expiresAt <= Date.now()) return null;
    return session;
}
function setSessionCookie(res, token, maxAgeSeconds) {
    const attributes = [
        `balls49_session=${encodeURIComponent(token)}`,
        'Path=/', 'HttpOnly', `SameSite=${SITE_PUBLIC_MODE ? 'None' : 'Lax'}`, `Max-Age=${maxAgeSeconds}`
    ];
    if (SITE_PUBLIC_MODE || process.env.NODE_ENV === 'production' || process.env.SESSION_COOKIE_SECURE === 'true') attributes.push('Secure');
    res.setHeader('Set-Cookie', attributes.join('; '));
}
function clearSessionCookie(res) {
    const attributes = ['balls49_session=', 'Path=/', 'HttpOnly', `SameSite=${SITE_PUBLIC_MODE ? 'None' : 'Lax'}`, 'Max-Age=0'];
    if (SITE_PUBLIC_MODE || process.env.NODE_ENV === 'production' || process.env.SESSION_COOKIE_SECURE === 'true') attributes.push('Secure');
    res.setHeader('Set-Cookie', attributes.join('; '));
}
function allowSiteAuthAttempt(req, res, rules) {
    const now = Date.now();
    const ip = req.socket.remoteAddress || 'unknown';
    const keys = rules.map(rule => ({ ...rule, key: `${rule.scope}:${rule.identity || ip}` }));
    if (siteAuthRateLimits.size + keys.filter(rule => !siteAuthRateLimits.has(rule.key)).length > 10000) {
        for (const [key, bucket] of siteAuthRateLimits) {
            if (bucket.resetAt <= now) siteAuthRateLimits.delete(key);
        }
        if (siteAuthRateLimits.size + keys.filter(rule => !siteAuthRateLimits.has(rule.key)).length > 10000) {
            sendJson(res, 503, { error: 'Authentication is temporarily busy. Please try again shortly.' });
            return false;
        }
    }
    let retryAfter = 0;
    for (const rule of keys) {
        const bucket = siteAuthRateLimits.get(rule.key);
        if (bucket && bucket.resetAt > now && bucket.count >= rule.limit) {
            retryAfter = Math.max(retryAfter, Math.ceil((bucket.resetAt - now) / 1000));
        }
    }
    if (retryAfter) {
        res.setHeader('Retry-After', String(retryAfter));
        sendJson(res, 429, { error: 'Too many attempts. Please wait before trying again.' });
        return false;
    }
    for (const rule of keys) {
        const bucket = siteAuthRateLimits.get(rule.key);
        if (!bucket || bucket.resetAt <= now) {
            siteAuthRateLimits.set(rule.key, { count: 1, resetAt: now + rule.windowMs });
        } else {
            bucket.count += 1;
        }
    }
    if (siteAuthRateLimits.size > 5000) {
        for (const [key, bucket] of siteAuthRateLimits) {
            if (bucket.resetAt <= now) siteAuthRateLimits.delete(key);
        }
    }
    return true;
}
function publicAccount(session) {
    if (!session || session.admin) return null;
    const user = getSiteUser(session.email);
    const plan = user && user.expiresAt > Date.now() ? user.plan : { tier: 'trial', games: [], expiresAt: null, telegram: false };
    return { email: session.email, plan };
}
function latestSettledPredictionDrawId() {
    return predictionLog.reduce((latestId, record) => {
        const drawId = Number(record?.drawId);
        return record?.result && typeof record.result === 'object' && Number.isSafeInteger(drawId)
            ? Math.max(latestId, drawId)
            : latestId;
    }, 0);
}
function reconcilePredictionStakePlans(user) {
    const plans = user.predictionStakePlans && typeof user.predictionStakePlans === 'object'
        ? user.predictionStakePlans
        : {};
    let changed = false;
    for (const market of siteMarkets) {
        const plan = plans[market];
        if (!plan || plan.locked !== true || !Number.isSafeInteger(plan.step) || !Number.isFinite(Number(plan.baseAmount))) continue;
        const lastProcessedDrawId = Number(plan.lastProcessedDrawId) || 0;
        const settledPredictions = predictionLog
            .filter(record => record?.result && typeof record.result === 'object'
                && Number.isSafeInteger(Number(record.drawId))
                && Number(record.drawId) > lastProcessedDrawId
                && ['WIN', 'LOSS', 'SKIP'].includes(record.result[market]))
            .sort((left, right) => Number(left.drawId) - Number(right.drawId));
        for (const record of settledPredictions) {
            const outcome = record.result[market];
            if (outcome === 'WIN') plan.step = 1;
            else if (outcome === 'LOSS') plan.step = Math.min(Number.MAX_SAFE_INTEGER, plan.step + 1);
            plan.lastProcessedDrawId = String(record.drawId);
            changed = true;
        }
    }
    if (changed || !user.predictionStakePlans) {
        user.predictionStakePlans = plans;
        saveSiteUser(user);
    }
    return plans;
}
let globalTracker = { 
    u4: { step: 1 },
    bet49: { step: 1 },
    color: { step: 1 },
    sum: { step: 1 },
    totalColor: { step: 1 },
    totalColor2: { step: 1 },
    unified: { step: 1 }
};
const SNIPER_SETTING_MARKETS = ['betzero', 'rainbow', 'hilo', 'totalColor', 'totalColor2', 'unified'];
const SNIPER_TRACKERS = ['u4', 'color', 'sum', 'totalColor', 'totalColor2', 'unified'];
const TRACKER_TO_SNIPER_MARKET = { u4: 'betzero', color: 'rainbow', sum: 'hilo', totalColor: 'totalColor', totalColor2: 'totalColor2', unified: 'unified' };
const makeDefaultSniperSettings = () => Object.fromEntries(SNIPER_SETTING_MARKETS.map(market => [market, { enabled: false, step: 0, resetLosses: 0 }]));
const makeDefaultSniperState = () => Object.fromEntries(SNIPER_TRACKERS.map(tracker => [tracker, { losses: 0, waitingForTarget: false }]));
const SUMMARY_MODEL_MARKETS = ['u4', 'color', 'sum', 'totalColor'];
const makeDefaultSummaryModelMarkets = () => Object.fromEntries(SUMMARY_MODEL_MARKETS.map(market => [market, false]));

function getSniperSettings(config, trackerKey) {
    const market = TRACKER_TO_SNIPER_MARKET[trackerKey];
    const saved = market && config.sniperSettings?.[market];
    if (saved) return saved;
    return { enabled: !!config.sniperMode, step: config.sniperStep || 0, resetLosses: config.sniperResetLosses || 0 };
}

function sniperAllowsEntry(session, trackerKey) {
    const settings = getSniperSettings(session.config, trackerKey);
    if (!settings.enabled || settings.step < 1 || settings.resetLosses < 1) return true;

    const currentGlobalStep = globalTracker[trackerKey]?.step || 1;
    const state = session.sniperState[trackerKey] || (session.sniperState[trackerKey] = { losses: 0, waitingForTarget: false });
    if (state.waitingForTarget) {
        if (currentGlobalStep !== settings.step) return false;
        state.waitingForTarget = false;
    }
    return currentGlobalStep >= settings.step;
}
let lastDrawId = null, predSentForId = null, lastPrediction = null;
let lastGlobalDrawId = null; 
let publicClock = { drawId: null, timeLeftSeconds: null, drawDate: null, observedAt: null };
let globalDefaultStakes = { u4: 0, bet49: 0, color: 0, sum: 0, totalColor: 0, totalColor2: 0 };

const processedDrawIds = new Set();
const userSessions = {};

function getSession(clientId) {
    if (!userSessions[clientId]) {
        userSessions[clientId] = {
            userTracker: { 
                u4: { step: 1 }, 
                bet49: { step: 1 },
                color: { step: 1 }, 
                sum: { step: 1 },
                totalColor: { step: 1 },
                totalColor2: { step: 1 },
                unified: { step: 1 },
                lastPredDrawId: null
            },
            wallets: {
                u4: { name: 'BetZero Wallet', bankroll: 0, odds: 1.65 },
                bet49: { name: 'Bet49 Wallet', bankroll: 0, odds: 7.80 },
                color: { name: 'Rainbow Wallet', bankroll: 0, odds: 1.50 },
                sum: { name: 'High/Low Wallet', bankroll: 0, odds: 2.00, multiplier: 1.40 },
                totalColor: { name: 'TC (3-Way) Wallet', bankroll: 0, odds: 3.8 },
                totalColor2: { name: 'TC (2-Way) Wallet', bankroll: 0, odds: 3.8 }
            },
            martingaleState: {
                u4: { active: false, localStep: 1, isRollover: false, rolloverStake: 0, inShadowMode: false },
                bet49: { active: false, localStep: 1, isRollover: false, rolloverStake: 0, inShadowMode: false },
                color: { active: false, localStep: 1, isRollover: false, rolloverStake: 0, inShadowMode: false },
                sum: { active: false, localStep: 1, isRollover: false, rolloverStake: 0, lastStandardStake: 0, inShadowMode: false },
                totalColor: { active: false, localStep: 1, isRollover: false, rolloverStake: 0, rolloverStage: 0, inShadowMode: false },
                totalColor2: { active: false, localStep: 1, inShadowMode: false }
            },
            masterState: {
                active: false,
                step: 1,
                deficit: 0,
                lastGamePlayed: null,
                lastStake: 0,
                inShadowMode: false
            },
            cooldowns: { u4: 0, bet49: 0, color: 0, sum: 0, totalColor: 0, totalColor2: 0, unified: 0 },
            sniperState: makeDefaultSniperState(),
            config: {
                initialStakes: { u4: 0, bet49: 0, color: 0, sum: 0, totalColor: 0, totalColor2: 0 },
                maxSteps: { u4: 0, bet49: 0, color: 0, sum: 0, totalColor: 0, totalColor2: 0 },
                enabledGames: { u4: false, bet49: false, color: false, sum: false, totalColor: false, totalColor2: false },
                takeProfit: 0, stopLoss: 0,
                schedule: { stopTime: '', active: false },
                step1Only: false, flatBetting: false,
                sniperMode: false, sniperStep: 0, sniperResetLosses: 0,
                sniperSettings: makeDefaultSniperSettings(),
                summaryModelMarkets: makeDefaultSummaryModelMarkets(),
                dynamicStakePercent: 0, cbMaxLosses: 0, cbCooldown: 0,
                mlOverrideMode: false,
                unifiedMode: false,
                bzRbRollover: false,
                hiloRollover: false,
                tc3Rollover: false,
                tc3RolloverTarget: 3,
                shadowMode: false,
                weightedStaking: false,
                hiloMultiplier: 2.0,
                telegramChatId: null
            },
            stats: {
                startTime: Date.now(),
                betsPlaced: 0, wins: 0, losses: 0,
                currentWinStreak: 0, maxWinStreak: 0,
                currentLossStreak: 0, maxLossStreak: 0,
                totalReturned: 0, lastResult: null, lastStake: 0, lastOdds: 1.65,
                isHalted: false, haltReason: "",
                liveAccountBalance: 0,
                virtualBalance: 0,
                initialVirtualBalance: null
            },
            pendingBetPayload: null,
            lastBetDrawId: null,
            lastBetDetails: null,
            balanceVerification: {
                pendingWinSync: false,
                balanceBeforeWin: 0,
                skippedDraw: null,
                refreshClicked: false
            },
            failedBetRecovery: null
        };
        restoreSession(userSessions[clientId], clientId);
    }
    return userSessions[clientId];
}

function syncSessionFromParams(session, params) {
    const u4Stake = params.get('u4Stake');
    const colorStake = params.get('colorStake');
    const sumStake = params.get('sumStake');
    const tcStake = params.get('tcStake');
    const tc2Stake = params.get('tc2Stake');
    if (u4Stake !== null) session.config.initialStakes.u4 = parseInt(u4Stake, 10) || 0;
    if (colorStake !== null) session.config.initialStakes.color = parseInt(colorStake, 10) || 0;
    if (sumStake !== null) session.config.initialStakes.sum = parseInt(sumStake, 10) || 0;
    if (tcStake !== null) session.config.initialStakes.totalColor = parseInt(tcStake, 10) || 0;
    if (tc2Stake !== null) session.config.initialStakes.totalColor2 = parseInt(tc2Stake, 10) || 0;
}

function isTimeUp(schedule) {
    if (!schedule || !schedule.active || !schedule.stopTime) return false;
    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();
    const [tH, tM] = schedule.stopTime.split(':').map(Number);
    return currentMins >= (tH * 60 + tM);
}

const PREDICTIONS_FILE = path.join(__dirname, 'predictions.json');
const LAST_PRED_FILE = path.join(__dirname, 'last_prediction.json');
const TELEGRAM_PREDICTION_OUTBOX_FILE = path.join(__dirname, 'telegram_prediction_outbox.json');
const STREAKS_FILE = path.join(__dirname, 'streaks.json');
const WIN_STEPS_FILE = path.join(__dirname, 'win_steps.json');
const ML_STREAKS_FILE = path.join(__dirname, 'ml_streaks.json');
const ML_RETRAIN_FILE = path.join(__dirname, 'ml_retraining_model.json');
const ML_RETRAINER_SCRIPT = path.join(__dirname, 'ml_retrainer.py');

let modelRefreshMarkers = { 10: 0, 50: 0, 100: 0 };

function loadJSON(file, fallback) {
    let contents;
    try {
        contents = fs.readFileSync(file, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') return fallback;
        const message = `[Persistence] Failed to read JSON file "${file}": ${error.message || error}`;
        console.error(message);
        throw new Error(message);
    }

    try {
        return JSON.parse(contents);
    } catch (error) {
        const message = `[Persistence] Failed to parse JSON file "${file}": ${error.message || error}`;
        console.error(message);
        throw new Error(message);
    }
}

function saveJSON(file, data) {
    let serialized;
    try {
        serialized = JSON.stringify(data, null, 2);
        if (serialized === undefined) throw new TypeError('JSON serialization returned no data.');
    } catch (error) {
        const message = `[Persistence] Failed to serialize JSON for "${file}": ${error.message || error}`;
        console.error(message);
        throw new Error(message);
    }

    const temporaryFile = `${file}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(temporaryFile, serialized);
        fs.renameSync(temporaryFile, file);
    } catch (error) {
        try {
            fs.unlinkSync(temporaryFile);
        } catch (cleanupError) {
            if (cleanupError.code !== 'ENOENT') {
                console.error(`[Persistence] Could not remove temporary file "${temporaryFile}": ${cleanupError.message || cleanupError}`);
            }
        }
        const message = `[Persistence] Failed to write JSON file "${file}": ${error.message || error}`;
        console.error(message);
        throw new Error(message);
    }
}

let telegramPredictionOutbox = loadJSON(TELEGRAM_PREDICTION_OUTBOX_FILE, []);
if (!Array.isArray(telegramPredictionOutbox)) {
    throw new Error(`[Persistence] Telegram prediction outbox "${TELEGRAM_PREDICTION_OUTBOX_FILE}" must contain a JSON array; refusing to discard queued predictions.`);
}
let telegramPredictionDeliveryInFlight = false;

const persistedState = SITE_PUBLIC_MODE ? {} : loadJSON(SESSION_STATE_FILE, {});
const persistedSessions = persistedState.sessions || (persistedState.globalTracker ? {} : persistedState);

if (persistedState.globalTracker) {
    for (const key of Object.keys(globalTracker)) {
        if (persistedState.globalTracker[key]) globalTracker[key] = persistedState.globalTracker[key];
    }
}
lastDrawId = persistedState.lastDrawId ?? null;
predSentForId = persistedState.predSentForId ?? null;
lastGlobalDrawId = persistedState.lastGlobalDrawId ?? null;

function snapshotSession(session) {
    return JSON.parse(JSON.stringify({
        userTracker: session.userTracker,
        wallets: session.wallets,
        martingaleState: session.martingaleState,
        masterState: session.masterState,
        cooldowns: session.cooldowns,
        sniperState: session.sniperState,
        config: session.config,
        stats: session.stats,
        lastBetDrawId: session.lastBetDrawId,
        lastBetDetails: session.lastBetDetails,
        balanceVerification: {
            ...session.balanceVerification,
            pendingWinSync: false,
            refreshClicked: false
        }
    }));
}

function persistSessions() {
    const snapshots = {};
    for (const clientId in userSessions) snapshots[clientId] = snapshotSession(userSessions[clientId]);
    saveJSON(SESSION_STATE_FILE, {
        globalTracker,
        lastDrawId,
        predSentForId,
        lastGlobalDrawId,
        sessions: snapshots
    });
}

function restoreSession(session, clientId) {
    const saved = persistedSessions[clientId];
    if (!saved) return;

    for (const key of ['userTracker', 'wallets', 'martingaleState', 'masterState', 'cooldowns', 'sniperState', 'config', 'stats', 'balanceVerification']) {
        if (saved[key] && typeof saved[key] === 'object') Object.assign(session[key], saved[key]);
    }
    for (const tracker of SNIPER_TRACKERS) {
        const savedState = saved.sniperState?.[tracker];
        session.sniperState[tracker] = {
            losses: Number.isSafeInteger(savedState?.losses) && savedState.losses >= 0 ? savedState.losses : 0,
            waitingForTarget: savedState?.waitingForTarget === true
        };
    }
    if (saved.config && !saved.config.sniperSettings) {
        const legacy = { enabled: !!saved.config.sniperMode, step: saved.config.sniperStep || 0, resetLosses: saved.config.sniperResetLosses || 0 };
        session.config.sniperSettings = Object.fromEntries(SNIPER_SETTING_MARKETS.map(market => [market, { ...legacy }]));
    }
    session.config.summaryModelMarkets = {
        ...makeDefaultSummaryModelMarkets(),
        ...(saved.config?.summaryModelMarkets || {})
    };
    session.lastBetDrawId = saved.lastBetDrawId || null;
    session.lastBetDetails = saved.lastBetDetails || null;
    session.pendingBetPayload = null;
    session.failedBetRecovery = null;
}

if (!SITE_PUBLIC_MODE) {
    setInterval(() => {
        try {
            persistSessions();
        } catch (error) {
            console.error(`[Persistence] Session state was not saved: ${error.message || error}`);
        }
    }, 5000);
    process.on('SIGINT', () => { persistSessions(); process.exit(0); });
    process.on('SIGTERM', () => { persistSessions(); process.exit(0); });
}

function nowISO() { return new Date().toISOString(); }

function getSumRange(s) {
    s = parseInt(s, 10) || 0;
    return s <= 148 ? 'LOW' : s <= 151 ? 'MID' : 'HIGH';
}

function getBallColor(n) {
    if (n === 49) return 'yellow';
    return (n % 3) === 1 ? 'red' : (n % 3) === 2 ? 'blue' : 'green';
}

function getBallEmoji(n) {
    const c = getBallColor(n);
    return c === 'red' ? '🔴' : c === 'blue' ? '🔵' : c === 'green' ? '🟢' : '🟡';
}

let predictionLog = SITE_PUBLIC_MODE ? [] : loadJSON(PREDICTIONS_FILE, []);
if (!Array.isArray(predictionLog)) {
    throw new Error(`[Persistence] Prediction history "${PREDICTIONS_FILE}" must contain a JSON array.`);
}
if (!SITE_PUBLIC_MODE) {
    const persisted = loadJSON(LAST_PRED_FILE, null);
    if (persisted && persisted.drawId && persisted.pred) lastPrediction = persisted;
}

if (SITE_PUBLIC_MODE) {
    const feed = getPublicPredictionFeedStatement.get();
    if (feed) {
        try {
            lastPrediction = feed.current_json ? JSON.parse(feed.current_json) : null;
            publicClock = JSON.parse(feed.clock_json);
            predictionLog = listPublicPredictionHistoryStatement.all().map(row => JSON.parse(row.record_json));
        } catch (error) {
            throw new Error('Stored public prediction feed is invalid; refusing to serve corrupted feed data.');
        }
    }
}

function getBet49HistoricalLossStreaks() {
    const settledRecords = predictionLog
        .filter(record => record.result?.bet49 === 'WIN' || record.result?.bet49 === 'LOSS')
        .slice()
        .sort((left, right) => Number(left.drawId) - Number(right.drawId));
    let current = 0;
    let maximum = 0;
    for (const record of settledRecords) {
        if (record.result.bet49 === 'WIN') {
            current = 0;
        } else {
            current++;
            maximum = Math.max(maximum, current);
        }
    }
    return { current, maximum };
}

if (!SITE_PUBLIC_MODE && !(persistedState.globalTracker && persistedState.globalTracker.bet49)) {
    globalTracker.bet49.step = getBet49HistoricalLossStreaks().current + 1;
}

const lastPublishedHistoryHashes = new Map();
let predictionPublishInFlight = false;

function buildPublicFeedHistory() {
    return predictionLog.map(record => ({
        drawId: String(record.drawId ?? ''),
        drawDate: record.drawDate || null,
        timestamp: record.timestamp || null,
        settledAt: record.settledAt || null,
        summaryModel: buildPublicSummaryModel(record.mlShadow || record.summaryModel, record.predicted?.unified?.key),
        steps: record.steps && typeof record.steps === 'object' ? {
            bet49: safePublicCount(record.steps.bet49)
        } : null,
        predicted: {
            betzero: Array.isArray(record.predicted?.betzero) ? record.predicted.betzero : [],
            bet49: Number.isInteger(Number(record.predicted?.bet49)) ? Number(record.predicted.bet49) : null,
            rainbow: record.predicted?.rainbow || 'SKIP',
            totalColor: record.predicted?.totalColor ? {
                status: record.predicted.totalColor.status || 'SKIP',
                topColors: Array.isArray(record.predicted.totalColor.topColors) ? record.predicted.totalColor.topColors : [],
                noWinColor: record.predicted.totalColor.noWinColor || null
            } : null,
            totalColor2: record.predicted?.totalColor2 ? {
                status: record.predicted.totalColor2.status || 'SKIP',
                top2: Array.isArray(record.predicted.totalColor2.top2) ? record.predicted.totalColor2.top2 : []
            } : null,
            hilo: record.predicted?.hilo || 'SKIP',
            unified: record.predicted?.unified?.key ? { key: String(record.predicted.unified.key) } : null
        },
        result: record.result && typeof record.result === 'object' ? {
            balls: Array.isArray(record.result.balls) ? record.result.balls : [],
            total: record.result.total !== null && record.result.total !== undefined && Number.isFinite(Number(record.result.total))
                ? Number(record.result.total) : null,
            range: record.result.range || null,
            betzero: record.result.betzero || 'SKIP',
            bet49: record.result.bet49 || 'SKIP',
            rainbow: record.result.rainbow || 'SKIP',
            totalColor: record.result.totalColor || 'SKIP',
            totalColor2: record.result.totalColor2 || 'SKIP',
            hilo: record.result.hilo || 'SKIP',
            unified: record.result.unified || 'SKIP'
        } : null
    })).filter(record => record.drawId);
}

function getPublicSummaryLabel(value) {
    if (value === 'ENTER' || value === 'HOLD' || value === 'LEARNING') return value;
    if (!value || typeof value !== 'object') return null;
    if (value.recommendation === 'ENTER' || value.recommendation === 'HOLD') return value.recommendation;
    if (value.status === 'LEARNING' || value.status === 'INSUFFICIENT_BUCKET_DATA') return 'LEARNING';
    return null;
}

function buildPublicSummaryModel(source, unifiedKey = null) {
    const model = source && typeof source === 'object' ? source : {};
    const labels = {
        betzero: getPublicSummaryLabel(model.u4 ?? model.betzero),
        rainbow: getPublicSummaryLabel(model.color ?? model.rainbow),
        hilo: getPublicSummaryLabel(model.sum ?? model.hilo),
        totalColor: getPublicSummaryLabel(model.totalColor),
        unified: getPublicSummaryLabel(model.unified)
    };
    const unifiedMarket = { u4: 'betzero', color: 'rainbow', sum: 'hilo', totalColor: 'totalColor' }[unifiedKey];
    if (unifiedMarket) labels.unified = labels[unifiedMarket];
    return labels;
}

function getPublicSummaryLabelForMarket(summaryModel, market, unifiedKey = null) {
    if (market === 'unified') {
        const sourceMarket = { u4: 'betzero', color: 'rainbow', sum: 'hilo', totalColor: 'totalColor' }[unifiedKey];
        return sourceMarket ? summaryModel?.[sourceMarket] || null : summaryModel?.unified || null;
    }
    return summaryModel?.[market] || null;
}

const PUBLIC_MARKET_RESULT_KEYS = {
    betzero: 'betzero',
    bet49: 'bet49',
    rainbow: 'rainbow',
    totalColor: 'totalColor',
    totalColor2: 'totalColor2',
    hilo: 'hilo',
    unified: 'unified'
};

function safePublicCount(value) {
    const count = Number(value);
    return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function getMarketStatsResetAt() {
    const raw = getSiteSettingStatement.get('market_stats_reset_at')?.setting_value;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function resetMarketStatsTracking() {
    const resetAt = Date.now();
    setSiteSettingStatement.run('market_stats_reset_at', String(resetAt));
    return resetAt;
}

function getPublicMarketMaxLosses(records = predictionLog) {
    const runningLosses = Object.fromEntries(Object.keys(PUBLIC_MARKET_RESULT_KEYS).map(market => [market, 0]));
    const maximumLosses = Object.fromEntries(Object.keys(PUBLIC_MARKET_RESULT_KEYS).map(market => [market, 0]));
    const resetAt = getMarketStatsResetAt();

    for (const record of records.slice().reverse()) {
        const recordTime = Date.parse(record?.settledAt || record?.timestamp || '');
        if (resetAt && (!Number.isFinite(recordTime) || recordTime <= resetAt)) continue;
        if (!record?.result || typeof record.result !== 'object') continue;
        for (const [market, resultKey] of Object.entries(PUBLIC_MARKET_RESULT_KEYS)) {
            const outcome = record.result[resultKey];
            if (outcome === 'WIN') {
                runningLosses[market] = 0;
            } else if (outcome === 'LOSS') {
                runningLosses[market] += 1;
                maximumLosses[market] = Math.max(maximumLosses[market], runningLosses[market]);
            }
        }
    }

    return maximumLosses;
}

function buildPublicMarketStats(currentRecord, records = predictionLog) {
    const maximumLosses = getPublicMarketMaxLosses(records);

    return Object.fromEntries(Object.keys(PUBLIC_MARKET_RESULT_KEYS).map(market => [market, {
        step: safePublicCount(currentRecord?.steps?.[market]),
        maxLosingStreak: maximumLosses[market]
    }]));
}

function buildPublicFeedCurrent() {
    if (!lastPrediction?.pred || lastPrediction.drawId === undefined || lastPrediction.drawId === null) return null;
    const pred = lastPrediction.pred;
    const currentRecord = predictionLog.find(record => String(record.drawId) === String(lastPrediction.drawId));
    return {
        drawId: String(lastPrediction.drawId),
        marketStats: buildPublicMarketStats(currentRecord),
        summaryModel: buildPublicSummaryModel(currentRecord?.mlShadow || lastPrediction.summaryModel, pred.unifiedPick?.key),
        pred: {
            betzeroStatus: pred.betzeroStatus === 'ACTIVE' ? 'ACTIVE' : 'SKIP',
            unlikely4: Array.isArray(pred.unlikely4) ? pred.unlikely4.map(item => ({ number: Number(item.number) })) : [],
            bet49Pick: Number.isInteger(Number(pred.bet49Pick)) ? Number(pred.bet49Pick) : null,
            rainbowStatus: pred.rainbowStatus === 'ACTIVE' ? 'ACTIVE' : 'SKIP',
            topColor: pred.topColor?.name ? { name: String(pred.topColor.name) } : null,
            totalColorPred: {
                status: pred.totalColorPred?.status === 'ACTIVE' ? 'ACTIVE' : 'SKIP',
                topColors: Array.isArray(pred.totalColorPred?.topColors) ? pred.totalColorPred.topColors : [],
                noWinColor: pred.totalColorPred?.noWinColor || null
            },
            totalColor2Pred: {
                status: pred.totalColor2Pred?.status === 'ACTIVE' ? 'ACTIVE' : 'SKIP',
                top2: Array.isArray(pred.totalColor2Pred?.top2) ? pred.totalColor2Pred.top2 : []
            },
            hiloStatus: pred.hiloStatus === 'ACTIVE' ? 'ACTIVE' : 'SKIP',
            sumRange: pred.sumRange || 'SKIP',
            unifiedPick: pred.unifiedPick?.key ? { key: String(pred.unifiedPick.key) } : null
        }
    };
}

async function publishPredictionSnapshot() {
    if (SITE_PUBLIC_MODE || !PREDICTION_INGEST_URL || predictionPublishInFlight) return;
    predictionPublishInFlight = true;
    try {
        const history = buildPublicFeedHistory();
        const historyUpdates = [];
        const batchHistoryHashes = [];
        for (const record of history) {
            const recordJson = JSON.stringify(record);
            const recordHash = crypto.createHash('sha256').update(recordJson).digest('hex');
            if (lastPublishedHistoryHashes.get(record.drawId) !== recordHash) {
                historyUpdates.push(record);
                batchHistoryHashes.push([record.drawId, recordHash]);
                if (historyUpdates.length >= 1000) break;
            }
        }
        const timestamp = String(Date.now());
        const snapshot = {
            version: 1,
            snapshotAt: Number(timestamp),
            current: buildPublicFeedCurrent(),
            clock: publicClock,
            historyUpdates
        };
        const body = JSON.stringify(snapshot);
        const signature = crypto.createHmac('sha256', PREDICTION_INGEST_SECRET).update(`${timestamp}.${body}`).digest('hex');
        const url = new URL(PREDICTION_INGEST_URL);
        await new Promise(resolve => {
            const request = https.request({
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    'X-Prediction-Timestamp': timestamp,
                    'X-Prediction-Signature': signature
                }
            }, response => {
                response.resume();
                response.on('end', () => {
                    if (response.statusCode >= 200 && response.statusCode < 300) {
                        for (const [drawId, recordHash] of batchHistoryHashes) lastPublishedHistoryHashes.set(drawId, recordHash);
                        resolve(true);
                    } else {
                        console.error(`[PredictionFeed] Publish failed (HTTP ${response.statusCode || 'unknown'}).`);
                        resolve(false);
                    }
                });
            });
            request.setTimeout(10000, () => request.destroy(new Error('Prediction feed request timed out')));
            request.on('error', error => {
                console.error(`[PredictionFeed] Publish failed (${error.code || 'network error'}).`);
                resolve(false);
            });
            request.end(body);
        });
    } finally {
        predictionPublishInFlight = false;
    }
}

function ensureStreaksFile() { if (!fs.existsSync(STREAKS_FILE)) saveJSON(STREAKS_FILE, {}); }
function ensureWinStepsFile() { if (!fs.existsSync(WIN_STEPS_FILE)) saveJSON(WIN_STEPS_FILE, { u4: {}, color: {}, sum: {}, totalColor: {} }); }
function ensureMLStreaksFile() { if (!fs.existsSync(ML_STREAKS_FILE)) saveJSON(ML_STREAKS_FILE, { u4: { current: 0, worst: 0, w: 0, l: 0 }, color: { current: 0, worst: 0, w: 0, l: 0 }, sum: { current: 0, worst: 0, w: 0, l: 0 }, totalColor: { current: 0, worst: 0, w: 0, l: 0 } }); }

function gameResultKeyForML(key) {
    return {
        u4: 'betzero',
        color: 'rainbow',
        sum: 'hilo',
        totalColor: 'totalColor'
    }[key] || key;
}

function getAdaptiveLongRunCalibration(key, history = predictionLog) {
    const resultKey = gameResultKeyForML(key);
    const windows = [
        { size: 10, weight: 0.50 },
        { size: 50, weight: 0.30 },
        { size: 100, weight: 0.20 }
    ];

    let weightedWindowRate = 0;
    let totalWeight = 0;
    let totalWins = 0;
    let totalRecords = 0;

    windows.forEach(window => {
        const slice = Array.isArray(history) ? history.slice(0, window.size) : [];
        let wins = 0;
        let records = 0;

        slice.forEach(entry => {
            const outcome = entry && entry.result ? entry.result[resultKey] : null;
            if (outcome === 'WIN' || outcome === 'LOSS') {
                records++;
                if (outcome === 'WIN') wins++;
            }
        });

        if (records > 0) {
            const winRate = wins / records;
            const reliability = Math.min(1, records / Math.max(1, window.size));
            weightedWindowRate += (winRate - 0.50) * window.weight * reliability;
            totalWeight += window.weight;
            totalWins += wins;
            totalRecords += records;
        }
    });

    let calibrationBias = 0;
    if (totalWeight > 0 && totalRecords >= 5) {
        const observedRate = totalWins / totalRecords;
        const drift = observedRate - 0.50;
        calibrationBias = Math.max(-0.18, Math.min(0.24, drift * 0.34));
        calibrationBias += Math.max(-0.04, Math.min(0.04, (weightedWindowRate / totalWeight) * 0.10));
    }

    const recent = Array.isArray(history) ? history.slice(0, 20) : [];
    const targetResultKey = resultKey;
    const supportKeys = {
        u4: ['color', 'sum', 'totalColor'],
        color: ['u4', 'sum', 'totalColor'],
        sum: ['u4', 'color', 'totalColor'],
        totalColor: ['u4', 'color', 'sum']
    }[key] || [];

    let patternAgreement = 0;
    let patternSamples = 0;
    recent.forEach(entry => {
        if (!entry || !entry.result) return;
        const targetStatus = entry.result[targetResultKey];
        const targetOutcome = targetStatus === 'WIN' ? 1 : (targetStatus === 'LOSS' ? -1 : 0);
        if (targetOutcome === 0) return;

        supportKeys.forEach(otherKey => {
            const map = { u4: 'betzero', color: 'rainbow', sum: 'hilo', totalColor: 'totalColor' };
            const otherResultKey = map[otherKey];
            const otherStatus = entry.result[otherResultKey];
            const otherOutcome = otherStatus === 'WIN' ? 1 : (otherStatus === 'LOSS' ? -1 : 0);
            if (otherOutcome === 0) return;
            patternSamples++;
            if (targetOutcome === otherOutcome) patternAgreement++;
        });
    });

    if (patternSamples > 0) {
        const agreementRate = patternAgreement / patternSamples;
        if (agreementRate >= 0.60) {
            calibrationBias += 0.04;
        } else if (agreementRate <= 0.35) {
            calibrationBias -= 0.04;
        }
    }

    return {
        bias: parseFloat(Math.max(-0.30, Math.min(0.30, calibrationBias)).toFixed(4)),
        sampleCount: totalRecords,
        observedRate: totalRecords ? totalWins / totalRecords : 0
    };
}

function ensureModelStore() {
    if (!fs.existsSync(path.dirname(ML_RETRAIN_FILE))) fs.mkdirSync(path.dirname(ML_RETRAIN_FILE), { recursive: true });
    if (!fs.existsSync(ML_RETRAIN_FILE)) {
        saveJSON(ML_RETRAIN_FILE, {
            version: 1,
            updatedAt: null,
            marketModels: {
                u4: { samples: 0, bias: 0, winRate10: 0.50, winRate50: 0.50, winRate100: 0.50 },
                color: { samples: 0, bias: 0, winRate10: 0.50, winRate50: 0.50, winRate100: 0.50 },
                sum: { samples: 0, bias: 0, winRate10: 0.50, winRate50: 0.50, winRate100: 0.50 },
                totalColor: { samples: 0, bias: 0, winRate10: 0.50, winRate50: 0.50, winRate100: 0.50 }
            }
        });
    }
}

function getMarketResultKey(key) {
    return {
        u4: 'betzero',
        color: 'rainbow',
        sum: 'hilo',
        totalColor: 'totalColor',
        totalColor2: 'totalColor2'
    }[key] || key;
}

function computeWindowRate(history, key, windowSize) {
    const resultKey = getMarketResultKey(key);
    const slice = Array.isArray(history) ? history.slice(0, windowSize) : [];
    let records = 0;
    let wins = 0;
    slice.forEach(entry => {
        const outcome = entry && entry.result ? entry.result[resultKey] : null;
        if (outcome === 'WIN' || outcome === 'LOSS') {
            records++;
            if (outcome === 'WIN') wins++;
        }
    });
    if (records === 0) return 0.50;
    return wins / records;
}

function refreshRetrainingModel(history = predictionLog) {
    ensureModelStore();
    const store = loadJSON(ML_RETRAIN_FILE, { version: 1, updatedAt: null, marketModels: {} });
    const latest = Array.isArray(history) ? history.slice(0, 1000) : [];
    const keys = ['u4', 'color', 'sum', 'totalColor'];

    keys.forEach(key => {
        const sampleSize = Math.min(latest.length, 500);
        if (sampleSize < 10) {
            store.marketModels[key] = store.marketModels[key] || { samples: 0, bias: 0, winRate10: 0.50, winRate50: 0.50, winRate100: 0.50 };
            return;
        }

        const rates = {
            winRate10: computeWindowRate(latest, key, 10),
            winRate50: computeWindowRate(latest, key, 50),
            winRate100: computeWindowRate(latest, key, 100)
        };

        const observedRate = (rates.winRate10 + rates.winRate50 + rates.winRate100) / 3;
        const bias = Math.max(-0.20, Math.min(0.20, (observedRate - 0.50) * 0.30));

        store.marketModels[key] = {
            samples: Math.max(0, sampleSize),
            bias: parseFloat(bias.toFixed(4)),
            winRate10: parseFloat(rates.winRate10.toFixed(4)),
            winRate50: parseFloat(rates.winRate50.toFixed(4)),
            winRate100: parseFloat(rates.winRate100.toFixed(4))
        };
    });

    store.updatedAt = new Date().toISOString();
    saveJSON(ML_RETRAIN_FILE, store);
}

function getRetrainedModelBias(key, predData) {
    ensureModelStore();
    const store = loadJSON(ML_RETRAIN_FILE, { version: 1, updatedAt: null, marketModels: {} });
    const market = store.marketModels && store.marketModels[key];
    if (!market || market.samples < 10) return 0;
    return parseFloat(Math.max(-0.20, Math.min(0.20, market.bias || 0)).toFixed(4));
}

function getShadowFeatureBuckets(key, pred, score, currentStep) {
    const scoreBucket = score < 0.40 ? 'low' : (score < 0.70 ? 'mid' : 'high');
    const stepBucket = currentStep <= 1 ? '1' : (currentStep === 2 ? '2' : '3+');

    if (key === 'u4') {
        const pool = Number(pred?.brainData?.betzero?.poolSize || 0);
        return {
            score: scoreBucket,
            step: stepBucket,
            pool: pool < 12 ? 'under12' : (pool < 15 ? '12to14' : '15plus')
        };
    }
    if (key === 'color') {
        const freq = Number(pred?.brainData?.rainbow?.maxFreq || 0);
        return {
            score: scoreBucket,
            step: stepBucket,
            frequency: freq < 29 ? 'under29' : (freq < 32 ? '29to31' : '32plus')
        };
    }
    if (key === 'sum') {
        const signal = String(pred?.sumRange || '').toUpperCase();
        return {
            score: scoreBucket,
            step: stepBucket,
            signal: ['LOW', 'MID', 'HIGH'].includes(signal) ? signal : 'unknown'
        };
    }
    if (key === 'totalColor') {
        const gap = Number(pred?.totalColorPred?.gap || 0);
        return {
            score: scoreBucket,
            step: stepBucket,
            gap: gap < 0.10 ? 'under010' : (gap < 0.20 ? '010to019' : '20plus')
        };
    }
    return {};
}

function getShadowModelDecision(key, pred, score, currentStep) {
    const active = {
        u4: pred?.betzeroStatus === 'ACTIVE',
        color: pred?.rainbowStatus === 'ACTIVE',
        sum: pred?.hiloStatus === 'ACTIVE',
        totalColor: pred?.totalColorPred?.status === 'ACTIVE'
    }[key];
    if (!active) return { status: 'NO_ACTIVE_PREDICTION', recommendation: null };

    const store = loadJSON(ML_RETRAIN_FILE, { marketModels: {} });
    const model = store.marketModels?.[key];
    if (!model || model.samples < 30) {
        return { status: 'LEARNING', recommendation: null, settledSamples: model?.samples || 0 };
    }

    const candidateBuckets = getShadowFeatureBuckets(key, pred, score, currentStep);
    const supportBuckets = {};
    for (const [feature, value] of Object.entries(candidateBuckets)) {
        const bucket = model.featureBuckets?.[feature]?.[value];
        if (bucket && bucket.samples >= 20 && Number.isFinite(bucket.winRate)) {
            supportBuckets[feature] = { samples: bucket.samples, winRate: bucket.winRate };
        }
    }

    const evidence = Object.values(supportBuckets);
    if (evidence.length < 2) {
        return {
            status: 'INSUFFICIENT_BUCKET_DATA',
            recommendation: null,
            settledSamples: model.samples,
            supportedFeatures: evidence.length
        };
    }

    const shadowScore = evidence.reduce((sum, item) => sum + item.winRate, 0) / evidence.length;
    const baseline = ['winRate10', 'winRate50', 'winRate100']
        .reduce((sum, field) => sum + Number(model[field] || 0.5), 0) / 3;
    return {
        status: 'OBSERVING',
        recommendation: shadowScore >= baseline + 0.03 ? 'ENTER' : 'HOLD',
        score: Number(shadowScore.toFixed(4)),
        baseline: Number(baseline.toFixed(4)),
        settledSamples: model.samples,
        supportBuckets
    };
}

function passesSummaryModelGate(session, key, pred, score) {
    if (!session.config.summaryModelMarkets?.[key]) return true;
    const currentStep = globalTracker[key]?.step || 1;
    return getShadowModelDecision(key, pred, score, currentStep).recommendation === 'ENTER';
}

function refreshRetrainingModelArtifactFromLog() {
    try {
        const python = process.env.PYTHON_CMD || 'python';
        childProcess.execFileSync(python, [ML_RETRAINER_SCRIPT, PREDICTIONS_FILE, ML_RETRAIN_FILE], {
            cwd: __dirname,
            stdio: 'ignore'
        });
        const model = loadJSON(ML_RETRAIN_FILE, null);
        if (!model?.marketModels) throw new Error('Retrainer completed without writing a valid model artifact.');
        const sampleCounts = Object.entries(model.marketModels)
            .map(([key, market]) => `${key}=${Number(market.samples) || 0}`)
            .join(', ');
        console.log(`[ML] Retraining complete. Settled samples: ${sampleCounts || 'none'}.`);
    } catch (e) {
        console.error(`[ML] Retraining failed: ${e.message || e}. Bot will continue with the last available model.`);
    }
}

function scheduleRetrainingRefresh(historyLength = predictionLog.length) {
    if (!Array.isArray(predictionLog)) return;
    for (const windowSize of [10, 50, 100]) {
        if (historyLength >= windowSize && historyLength % windowSize === 0 && modelRefreshMarkers[windowSize] !== historyLength) {
            modelRefreshMarkers[windowSize] = historyLength;
            refreshRetrainingModelArtifactFromLog();
        }
    }
}

function evaluateMLEntryConfidence(key, currentStep, predData, liveStreaks) {
    const winStepsData = loadJSON(WIN_STEPS_FILE, { u4: {}, color: {}, sum: {}, totalColor: {} });
    const strategyWins = winStepsData[key] || {};
    
    let totalWinsAtStep = strategyWins[String(currentStep)] || 1;
    let totalRecordedWins = Object.values(strategyWins).reduce((a, b) => a + b, 1);
    let stepProbabilityWeight = totalWinsAtStep / totalRecordedWins;

    let baseScore = 0.30 + (stepProbabilityWeight * 0.50);
    let riskPenalty = (currentStep - 1) * 0.05; 
    let confidenceScore = baseScore - riskPenalty;

    const adaptive = getAdaptiveLongRunCalibration(key, predictionLog);
    const retrainBias = getRetrainedModelBias(key, predData);
    confidenceScore += adaptive.bias + retrainBias;

    if (predData && predData.brainData) {
        let currentLossStreak = (liveStreaks && liveStreaks[key]) ? (liveStreaks[key].current || 0) : 0;
        
        if (currentLossStreak >= 2) {
            confidenceScore -= (currentLossStreak * 0.08);
        }

        if (key === 'u4' && predData.brainData.betzero) {
            let poolSize = predData.brainData.betzero.poolSize || 0;
            if (poolSize < 12) confidenceScore -= 0.20; 
            else if (poolSize >= 15) confidenceScore += 0.15; 
        } 
        else if (key === 'color' && predData.brainData.rainbow) {
            let maxFreq = predData.brainData.rainbow.maxFreq || 0;
            if (maxFreq < 29) confidenceScore -= 0.25; 
            else if (maxFreq >= 32) confidenceScore += 0.15; 
        }
        else if (key === 'sum' && predData.brainData.hilo) {
            confidenceScore -= 0.20; 
        }
        else if (key === 'totalColor' && predData.brainData.totalColor) {
            confidenceScore += 0.15;
        }
    }

    confidenceScore = Math.max(0.1, Math.min(1.0, confidenceScore));
    let recommendation = confidenceScore >= 0.40 ? 'ENTER' : 'EXIT_HOLD';
    
    return {
        score: parseFloat(confidenceScore.toFixed(2)),
        recommendation: recommendation,
        adaptiveBias: adaptive.bias,
        modelBias: retrainBias,
        sampleCount: adaptive.sampleCount,
        observedRate: adaptive.observedRate
    };
}

function updateOneStreakByMode(s, key, mode, won) {
    if (!s[key]) s[key] = { worst: 0, current: 0, winCurrent: 0, played: 0, won: 0 };
    if (!s[key][mode]) s[key][mode] = { worst: 0, current: 0, winCurrent: 0, played: 0, won: 0 };
    s[key].played++; s[key][mode].played++;
    if (won) {
        s[key].won++; s[key][mode].won++;
        s[key].current = 0; s[key][mode].current = 0;
    } else {
        s[key].current++; s[key][mode].current++;
        if (s[key].current > (s[key].worst || 0)) s[key].worst = s[key].current;
        if (s[key][mode].current > (s[key][mode].worst || 0)) s[key][mode].worst = s[key][mode].current;
    }
}

function getBetPayloadExposure(payload) {
    if (!payload || payload.action !== 'EXECUTE_BET') return 0;

    return Math.max(0, Number(payload.stake) || 0) +
        Math.max(0, Number(payload.bet49Stake) || 0) +
        Math.max(0, Number(payload.colorStake) || 0) +
        Math.max(0, Number(payload.sumStake) || 0) +
        (Math.max(0, Number(payload.tcStake) || 0) * 3) +
        (Math.max(0, Number(payload.tc2Stake) || 0) * 2);
}

function exceedsStopLossWithPayload(session, payload) {
    if (!session || session.config.stopLoss >= 0) return false;

    const currentLoss = Math.max(0, -Number(session.stats.totalReturned || 0));
    const nextExposure = getBetPayloadExposure(payload);
    return nextExposure > 0 && currentLoss + nextExposure > Math.abs(session.config.stopLoss);
}

function haltForPayloadRisk(session, clientId, payload) {
    const currentLoss = Math.max(0, -Number(session.stats.totalReturned || 0));
    const nextExposure = getBetPayloadExposure(payload);
    const stopLossLimit = Math.abs(session.config.stopLoss);

    session.pendingBetPayload = null;
    session.stats.isHalted = true;
    session.stats.haltReason = `Stop Loss Protection: next exposure exceeds limit (N${stopLossLimit.toLocaleString()})`;

    if (session.config.telegramChatId) {
        sendPersonalDM(
            session.config.telegramChatId,
            `Stop Loss Protection activated. Bet blocked before placement.\n` +
            `Current loss: N${currentLoss.toLocaleString()} | Next exposure: N${nextExposure.toLocaleString()} | Limit: N${stopLossLimit.toLocaleString()}\n` +
            `Automation paused for user ${clientId}.`
        ).catch(() => {});
    }
}

function runBacktest(gameKey, capital, basePercent, profile, drawWindow = 1000) {
    const meta = {
        betzero: { resultKey: 'betzero', odds: 1.65, costFactor: 1 },
        rainbow: { resultKey: 'rainbow', odds: 1.50, costFactor: 1 },
        hilo: { resultKey: 'hilo', odds: 2.00, costFactor: 1 },
        totalColor: { resultKey: 'totalColor', odds: 3.80, costFactor: 3 },
        totalColor2: { resultKey: 'totalColor2', odds: 3.80, costFactor: 2 }
    }[gameKey] || { resultKey: 'hilo', odds: 2.00, costFactor: 1 };
    const multiplier = gameKey === 'hilo' ? (profile === 'conservative' ? 1.40 : 2.00) : 1;
    const rolloverEnabled = gameKey === 'hilo' && (profile === 'conservative' || profile === 'highroller_scale');
    const baseStake = Math.max(50, Math.round((capital * basePercent / 100) / 50) * 50);
    const historyWindow = predictionLog
        .slice(0, drawWindow)
        .reverse();
    const completedResults = historyWindow
        .map(entry => entry.result && entry.result[meta.resultKey])
        .filter(result => result === 'WIN' || result === 'LOSS');
    const summarizeResults = (entries) => {
        const results = entries
            .map(entry => entry.result && entry.result[meta.resultKey])
            .filter(result => result === 'WIN' || result === 'LOSS');
        const wins = results.filter(result => result === 'WIN').length;
        return {
            records: results.length,
            wins,
            losses: results.length - wins,
            winRate: results.length ? Number(((wins / results.length) * 100).toFixed(2)) : 0
        };
    };
    const splitIndex = Math.ceil(historyWindow.length * 0.70);
    const calibrationResults = summarizeResults(historyWindow.slice(0, splitIndex));
    const validationResults = summarizeResults(historyWindow.slice(splitIndex));
    let currentObservedLosses = 0;
    let observedWorstLosingStreak = 0;
    for (const result of completedResults) {
        if (result === 'LOSS') {
            currentObservedLosses++;
            observedWorstLosingStreak = Math.max(observedWorstLosingStreak, currentObservedLosses);
        } else {
            currentObservedLosses = 0;
        }
    }
    let step = 1;
    let rolloverStake = 0;
    let totalExposure = 0;
    let profit = 0;
    let bets = 0;
    let wins = 0;
    let losses = 0;
    let peakExposure = 0;
    let halted = false;
    let stopReason = '';
    let stoppedAtStep = null;
    let stoppedAtDraw = null;
    let peakProfit = 0;
    let maxDrawdown = 0;
    let largestStake = 0;
    let highestStepReached = 1;
    let rolloverWins = 0;
    let rolloverFailures = 0;
    const resultsByStep = {};

    const getStake = () => {
        if (rolloverStake > 0) return rolloverStake;
        if (gameKey === 'hilo') return Math.round(baseStake * Math.pow(multiplier, step - 1));
        if (step <= 1) return baseStake;

        const targetProfit = baseStake * (meta.odds - 1);
        let totalLost = 0;
        let currentStake = baseStake;
        for (let currentStep = 1; currentStep <= step; currentStep++) {
            if (currentStep > 1) {
                if (gameKey === 'totalColor') currentStake = totalLost / 0.8;
                else if (gameKey === 'totalColor2') currentStake = (totalLost + baseStake) / 1.8;
                else currentStake = (totalLost + targetProfit) / (meta.odds - 1);
            }
            totalLost += currentStake * meta.costFactor;
        }
        return Math.round(currentStake);
    };

    for (const entry of historyWindow) {
        const result = entry.result && entry.result[meta.resultKey];
        if (result !== 'WIN' && result !== 'LOSS') continue;

        const stake = getStake();
        highestStepReached = Math.max(highestStepReached, step);
        const exposure = stake * meta.costFactor;
        const wasRollover = rolloverStake > 0;
        // Stop Loss is based on net P/L, not the total amount wagered over time.
        // A winning bet returns funds, so gross turnover must not consume the
        // entire loss budget by itself.
        if (profit - exposure <= -capital) {
            halted = true;
            stopReason = 'Stop Loss limit reached';
            stoppedAtStep = step;
            stoppedAtDraw = entry.drawId;
            break;
        }

        totalExposure += exposure;
        peakExposure = Math.max(peakExposure, totalExposure);
        largestStake = Math.max(largestStake, stake);
        bets++;
        if (!resultsByStep[step]) resultsByStep[step] = { wins: 0, losses: 0, stake };

        if (result === 'WIN') {
            wins++;
            resultsByStep[step].wins++;
            if (wasRollover) rolloverWins++;
            profit += (stake * meta.odds) - exposure;
            if (rolloverEnabled && rolloverStake === 0) {
                rolloverStake = Math.round(stake * multiplier);
            } else {
                rolloverStake = 0;
                step = 1;
            }
        } else {
            losses++;
            resultsByStep[step].losses++;
            if (wasRollover) rolloverFailures++;
            profit -= exposure;
            rolloverStake = 0;
            step++;
        }
        peakProfit = Math.max(peakProfit, profit);
        maxDrawdown = Math.max(maxDrawdown, peakProfit - profit);
    }

    return {
        game: gameKey,
        profile,
        baseStake,
        basePercent,
        maxSteps: highestStepReached,
        bets,
        wins,
        losses,
        winRate: bets ? Number(((wins / bets) * 100).toFixed(2)) : 0,
        profit: Math.round(profit),
        totalExposure: Math.round(totalExposure),
        peakExposure: Math.round(peakExposure),
        maxDrawdown: Math.round(maxDrawdown),
        largestStake: Math.round(largestStake),
        rolloverWins,
        rolloverFailures,
        resultsByStep,
        remainingRisk: Math.max(0, Math.round(capital - Math.max(0, -profit))),
        halted,
        stopReason,
        stoppedAtStep,
        stoppedAtDraw,
        observedWorstLosingStreak,
        calibration: calibrationResults,
        validation: validationResults,
        requestedDraws: drawWindow,
        availableDraws: historyWindow.length,
        records: completedResults.length
    };
}

function runLiveStyleBacktest(gameKey, capital, basePercent, profile, drawWindow = 1000) {
    const meta = {
        u4: { resultKey: 'betzero', scoreKey: 'betzero', odds: 1.65, costFactor: 1 },
        bet49: { resultKey: 'bet49', scoreKey: 'bet49', odds: 7.80, costFactor: 1 },
        color: { resultKey: 'rainbow', scoreKey: 'rainbow', odds: 1.50, costFactor: 1 },
        sum: { resultKey: 'hilo', scoreKey: 'hilo', odds: 2.00, costFactor: 1 },
        totalColor: { resultKey: 'totalColor', scoreKey: 'totalColor', odds: 3.80, costFactor: 3 },
        totalColor2: { resultKey: 'totalColor2', scoreKey: 'totalColor2', odds: 3.80, costFactor: 2 }
    };
    const selectedKey = gameKey === 'betzero' ? 'u4' : gameKey === 'rainbow' ? 'color' : gameKey === 'hilo' ? 'sum' : gameKey;
    const profileConfig = {
        conservative: { unified: false, shadow: true, weighted: false, cbLosses: 2, cooldown: 10, rollover: ['sum'] },
        unified_sniper: { unified: true, shadow: true, weighted: true, cbLosses: 3, cooldown: 10, rollover: [] },
        tc3_aggressive: { unified: false, shadow: true, weighted: false, cbLosses: 3, cooldown: 10, rollover: ['totalColor'] },
        antivol_ghost: { unified: true, shadow: true, weighted: false, cbLosses: 2, cooldown: 5, rollover: [] },
        highroller_scale: { unified: true, shadow: true, weighted: true, cbLosses: 4, cooldown: 5, rollover: ['u4', 'color', 'sum', 'totalColor'] }
    }[profile] || { unified: false, shadow: false, weighted: false, cbLosses: 0, cooldown: 0, rollover: [] };
    const thresholds = { u4: 0.50, bet49: 0, color: 0.65, sum: 0.55, totalColor: 0.45, totalColor2: 0 };
    const baseStake = Math.max(50, Math.round((capital * basePercent / 100) / 50) * 50);
    const historyWindow = predictionLog.slice(0, drawWindow).reverse();
    const states = {};
    const byGame = {};
    Object.keys(meta).forEach(key => {
        states[key] = { step: 1, rolloverStake: 0, losses: 0, cooldownUntil: -1, shadow: false };
        byGame[key] = { bets: 0, wins: 0, losses: 0, profit: 0, largestStake: 0 };
    });

    let profit = 0;
    let totalExposure = 0;
    let peakExposure = 0;
    let peakProfit = 0;
    let maxDrawdown = 0;
    let largestStake = 0;
    let bets = 0;
    let wins = 0;
    let losses = 0;
    let rolloverWins = 0;
    let rolloverFailures = 0;
    let highestStepReached = 1;
    let halted = false;
    let stopReason = '';
    let stoppedAtStep = null;
    let stoppedAtDraw = null;
    const resultsByStep = {};

    const normalizeUnifiedKey = key => key === 'sum' || key === 'hilo' ? 'sum' : key;
    const getStake = (key, state, mlScore) => {
        let stake = state.rolloverStake || baseStake;
        if (!state.rolloverStake && profileConfig.weighted && state.step === 1) {
            if (mlScore >= 0.80) stake *= 2;
            else if (mlScore >= 0.65) stake *= 1.5;
        }
        if (state.rolloverStake || state.step <= 1) return Math.round(stake);
        if (key === 'sum') return Math.round(baseStake * Math.pow(profile === 'conservative' ? 1.40 : 2.00, state.step - 1));

        const game = meta[key];
        const targetProfit = baseStake * (game.odds - 1);
        let totalLost = 0;
        let currentStake = baseStake;
        for (let currentStep = 1; currentStep <= state.step; currentStep++) {
            if (currentStep > 1) {
                if (key === 'totalColor') currentStake = totalLost / 0.8;
                else if (key === 'totalColor2') currentStake = (totalLost + baseStake) / 1.8;
                else currentStake = (totalLost + targetProfit) / (game.odds - 1);
            }
            totalLost += currentStake * game.costFactor;
        }
        return Math.round(currentStake);
    };

    for (const entry of historyWindow) {
        const rawKey = profileConfig.unified ? entry.predicted?.unified?.key : selectedKey;
        const key = normalizeUnifiedKey(rawKey);
        if (!meta[key]) continue;
        const game = meta[key];
        const result = entry.result && entry.result[game.resultKey];
        if (result !== 'WIN' && result !== 'LOSS') continue;

        const score = Number(entry.mlScores?.[game.scoreKey] || 0);
        if (score < thresholds[key]) continue;

        const state = states[key];
        if (state.cooldownUntil >= 0) {
            if (historyWindow.indexOf(entry) <= state.cooldownUntil) continue;
            state.cooldownUntil = -1;
        }
        if (state.shadow) {
            if (result === 'WIN') {
                state.shadow = false;
                state.step = 1;
                state.losses = 0;
            }
            continue;
        }
        const stake = getStake(key, state, score);
        highestStepReached = Math.max(highestStepReached, state.step);
        const exposure = stake * game.costFactor;
        if (profit - exposure <= -capital) {
            halted = true;
            stopReason = 'Stop Loss limit reached';
            stoppedAtStep = state.step;
            stoppedAtDraw = entry.drawId;
            break;
        }

        const wasRollover = state.rolloverStake > 0;
        totalExposure += exposure;
        peakExposure = Math.max(peakExposure, totalExposure);
        largestStake = Math.max(largestStake, stake);
        byGame[key].bets++;
        byGame[key].largestStake = Math.max(byGame[key].largestStake, stake);
        bets++;
        if (!resultsByStep[state.step]) resultsByStep[state.step] = { wins: 0, losses: 0 };

        if (result === 'WIN') {
            wins++;
            byGame[key].wins++;
            byGame[key].profit += (stake * game.odds) - exposure;
            resultsByStep[state.step].wins++;
            if (wasRollover) rolloverWins++;
            profit += (stake * game.odds) - exposure;
            if (profileConfig.rollover.includes(key) && !wasRollover) {
                state.rolloverStake = Math.round(stake * game.odds);
            } else {
                state.rolloverStake = 0;
                state.step = 1;
                state.losses = 0;
            }
        } else {
            losses++;
            byGame[key].losses++;
            byGame[key].profit -= exposure;
            resultsByStep[state.step].losses++;
            if (wasRollover) rolloverFailures++;
            profit -= exposure;
            state.rolloverStake = 0;
            state.step++;
            state.losses++;
            if (profileConfig.cbLosses > 0 && state.losses >= profileConfig.cbLosses) {
                if (profileConfig.shadow) state.shadow = true;
                else state.cooldownUntil = historyWindow.indexOf(entry) + profileConfig.cooldown;
            }
        }
        peakProfit = Math.max(peakProfit, profit);
        maxDrawdown = Math.max(maxDrawdown, peakProfit - profit);
    }

    const validRecords = historyWindow.filter(entry => {
        const key = normalizeUnifiedKey(profileConfig.unified ? entry.predicted?.unified?.key : selectedKey);
        return meta[key] && ['WIN', 'LOSS'].includes(entry.result?.[meta[key].resultKey]);
    });
    let observedLosses = 0;
    let observedWorstLosingStreak = 0;
    for (const entry of validRecords) {
        const key = normalizeUnifiedKey(profileConfig.unified ? entry.predicted?.unified?.key : selectedKey);
        if (entry.result[meta[key].resultKey] === 'LOSS') {
            observedLosses++;
            observedWorstLosingStreak = Math.max(observedWorstLosingStreak, observedLosses);
        } else {
            observedLosses = 0;
        }
    }
    const splitIndex = Math.ceil(historyWindow.length * 0.70);
    const getSegmentRate = entries => {
        const valid = entries.filter(entry => {
            const key = normalizeUnifiedKey(profileConfig.unified ? entry.predicted?.unified?.key : selectedKey);
            return meta[key] && ['WIN', 'LOSS'].includes(entry.result?.[meta[key].resultKey]);
        });
        const segmentWins = valid.filter(entry => {
            const key = normalizeUnifiedKey(profileConfig.unified ? entry.predicted?.unified?.key : selectedKey);
            return entry.result[key === 'sum' ? 'hilo' : meta[key].resultKey] === 'WIN';
        }).length;
        return { records: valid.length, wins: segmentWins, losses: valid.length - segmentWins, winRate: valid.length ? Number((segmentWins / valid.length * 100).toFixed(2)) : 0 };
    };

    return {
        mode: 'live-style', game: gameKey, profile, baseStake, basePercent, maxSteps: highestStepReached,
        requestedDraws: drawWindow, availableDraws: historyWindow.length, records: validRecords.length,
        bets, wins, losses, winRate: bets ? Number((wins / bets * 100).toFixed(2)) : 0,
        profit: Math.round(profit), totalExposure: Math.round(totalExposure), peakExposure: Math.round(peakExposure),
        maxDrawdown: Math.round(maxDrawdown), largestStake: Math.round(largestStake),
        remainingRisk: Math.max(0, Math.round(capital - Math.max(0, -profit))), rolloverWins, rolloverFailures,
        resultsByStep, byGame, observedWorstLosingStreak, stopReason, stoppedAtStep, stoppedAtDraw,
        halted, calibration: getSegmentRate(historyWindow.slice(0, splitIndex)), validation: getSegmentRate(historyWindow.slice(splitIndex))
    };
}

function getMartingaleStake(clientId, key, localStep, mlScore = 0) {
    const session = getSession(clientId);
    const walletConfig = session.wallets[key];
    let initialBaseUnit = session.config.initialStakes[key] || 0;

    if (session.config.dynamicStakePercent > 0 && session.wallets[key].bankroll > 0) {
        initialBaseUnit = Math.round(session.wallets[key].bankroll * (session.config.dynamicStakePercent / 100));
        if (initialBaseUnit < 50) initialBaseUnit = 50;
    }

    if (session.config.weightedStaking && localStep === 1 && mlScore > 0) {
        if (mlScore >= 0.80) initialBaseUnit = Math.round(initialBaseUnit * 2.0);
        else if (mlScore >= 0.65) initialBaseUnit = Math.round(initialBaseUnit * 1.5);
    }

    if (key === 'sum' && !session.martingaleState.sum.isRollover) {
        session.martingaleState.sum.lastStandardStake = Math.round(initialBaseUnit);
    }

    if ((key === 'u4' || key === 'color' || key === 'sum') && session.martingaleState[key].isRollover) {
        return { stake: session.martingaleState[key].rolloverStake, odds: walletConfig.odds };
    }

    if (key === 'totalColor' && session.martingaleState.totalColor.isRollover) {
        return { stake: session.martingaleState.totalColor.rolloverStake, odds: walletConfig.odds };
    }

    if (session.config.flatBetting || localStep <= 1) return { stake: initialBaseUnit, odds: walletConfig.odds };

    if (key === 'bet49') {
        const recoveryRatio = walletConfig.odds / (walletConfig.odds - 1);
        return { stake: Math.round(initialBaseUnit * Math.pow(recoveryRatio, localStep - 1)), odds: walletConfig.odds };
    }

    if (key === 'sum') {
        const mult = session.config.hiloMultiplier || 2.0;
        const state = session.martingaleState.sum;
        let currentStake = initialBaseUnit * Math.pow(mult, localStep - 1);
        state.lastStandardStake = Math.round(currentStake);
        return { stake: Math.round(currentStake), odds: walletConfig.odds };
    }

    if (key === 'totalColor') {
        let totalLost = 0;
        let currentStake = initialBaseUnit;
        for (let i = 1; i <= localStep; i++) {
            if (i === 1) {
                currentStake = initialBaseUnit;
            } else {
                currentStake = totalLost / 0.8;
            }
            totalLost += (currentStake * 3);
        }
        return { stake: Math.round(currentStake), odds: walletConfig.odds };
    }

    if (key === 'totalColor2') {
        let totalLost = 0;
        let currentStake = initialBaseUnit;
        for (let i = 1; i <= localStep; i++) {
            if (i === 1) {
                currentStake = initialBaseUnit;
            } else {
                currentStake = (totalLost + initialBaseUnit) / 1.8;
            }
            totalLost += (currentStake * 2);
        }
        return { stake: Math.round(currentStake), odds: walletConfig.odds };
    }

    if (walletConfig.multiplier) {
        let currentStake = initialBaseUnit * Math.pow(walletConfig.multiplier, localStep - 1);
        return { stake: Math.round(currentStake), odds: walletConfig.odds };
    }

    let targetProfit = initialBaseUnit * (walletConfig.odds - 1);
    let totalLost = 0.0, currentStake = initialBaseUnit;
    for (let i = 1; i <= localStep; i++) {
        if (i > 1) currentStake = (totalLost + targetProfit) / (walletConfig.odds - 1);
        totalLost += currentStake;
    }
    return { stake: Math.round(currentStake), odds: walletConfig.odds };
}

function getUnifiedMasterStake(clientId, targetGameKey, mlScore = 0) {
    const session = getSession(clientId);
    const odds = session.wallets[targetGameKey].odds;
    let baseUnit = session.config.initialStakes[targetGameKey] || 500;
    const mState = session.masterState;

    if (session.config.weightedStaking && mState.step === 1 && mlScore > 0) {
        if (mlScore >= 0.80) baseUnit = Math.round(baseUnit * 2.0);
        else if (mlScore >= 0.65) baseUnit = Math.round(baseUnit * 1.5);
    }

    if (session.config.bzRbRollover && (targetGameKey === 'u4' || targetGameKey === 'color' || targetGameKey === 'sum')) {
        const state = session.martingaleState[targetGameKey];
        if (state && state.isRollover) {
            return state.rolloverStake;
        }
    }

    if (session.config.tc3Rollover && targetGameKey === 'totalColor') {
        const state = session.martingaleState.totalColor;
        if (state && state.isRollover) {
            return state.rolloverStake;
        }
    }

    if (session.config.flatBetting || mState.step <= 1 || mState.deficit <= 0) {
        return Math.round(baseUnit);
    }
    
    if (targetGameKey === 'totalColor') {
        return Math.round(mState.deficit / 0.8);
    }

    const baseProfitTarget = baseUnit * (odds - 1);
    const requiredStake = (mState.deficit + baseProfitTarget) / (odds - 1);
    return Math.round(requiredStake);
}

function pushToGoogleSheet(data) {
    if (!GOOGLE_SHEET_URL) return;
    const payload = JSON.stringify(data);
    const url = new URL(GOOGLE_SHEET_URL);
    const req = https.request({
        hostname: url.hostname, path: url.pathname + url.search, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {});
    req.on('error', () => {}); req.write(payload); req.end();
}

function sendTelegram(text) {
    if (!TOKEN || !CHANNEL_CHAT_ID) return Promise.resolve(false);
    return sendTelegramToChat(CHANNEL_CHAT_ID, 'channel', text);
}

function sendTelegramToChat(chatId, label, text) {
    return new Promise((resolve) => {
        const body = JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' });
        const req = https.request({
            hostname: 'api.telegram.org', path: '/bot' + TOKEN + '/sendMessage', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, (res) => {
            let responseBody = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { responseBody += chunk; });
            res.on('end', () => {
                let result;
                try { result = JSON.parse(responseBody); } catch (e) {}
                if (res.statusCode < 200 || res.statusCode >= 300 || !result?.ok) {
                    const detail = typeof result?.description === 'string'
                        ? `: ${result.description.replace(/[\r\n]+/g, ' ').slice(0, 240)}`
                        : '';
                    console.error(`[Telegram] Send to ${label} failed (HTTP ${res.statusCode || 'unknown'}${detail}).`);
                    resolve(false);
                    return;
                }
                resolve(result?.ok === true);
            });
        });
        req.setTimeout(10000, () => req.destroy(new Error('Telegram request timed out')));
        req.on('error', (error) => {
            console.error(`[Telegram] Send to ${label} failed (${error.code || 'network error'}).`);
            resolve(false);
        });
        req.write(body); req.end();
    });
}

function persistTelegramPredictionOutbox() {
    saveJSON(TELEGRAM_PREDICTION_OUTBOX_FILE, telegramPredictionOutbox);
    return true;
}

function queueTelegramPrediction(drawId, text) {
    const drawKey = String(drawId);
    const existing = telegramPredictionOutbox.find(item => String(item.drawId) === drawKey);
    if (!existing) telegramPredictionOutbox.push({ drawId: drawKey, text, attempts: 0, nextAttemptAt: 0 });
    return persistTelegramPredictionOutbox();
}

async function flushTelegramPredictionOutbox() {
    if (telegramPredictionDeliveryInFlight || !TOKEN || !CHANNEL_CHAT_ID) return;
    const message = telegramPredictionOutbox.find(item => Number(item.nextAttemptAt) <= Date.now());
    if (!message) return;
    if (!persistTelegramPredictionOutbox()) return;
    telegramPredictionDeliveryInFlight = true;
    try {
        const sent = await sendTelegramToChat(CHANNEL_CHAT_ID, `prediction for draw ${message.drawId}`, message.text);
        if (sent) {
            telegramPredictionOutbox = telegramPredictionOutbox.filter(item => String(item.drawId) !== String(message.drawId));
        } else {
            message.attempts = Math.min(10, (Number(message.attempts) || 0) + 1);
            message.nextAttemptAt = Date.now() + Math.min(300000, 5000 * (2 ** Math.min(message.attempts, 6)));
        }
        persistTelegramPredictionOutbox();
    } finally {
        telegramPredictionDeliveryInFlight = false;
    }
}

function sendPersonalDM(chatId, text) {
    if (!TOKEN || !chatId) return Promise.resolve();
    return new Promise((resolve) => {
        const body = JSON.stringify({ chat_id: String(chatId), text, parse_mode: 'HTML' });
        const req = https.request({
            hostname: 'api.telegram.org', path: '/bot' + TOKEN + '/sendMessage', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, res => { res.on('data', () => {}); res.on('end', resolve); });
        req.on('error', resolve); req.write(body); req.end();
    });
}

async function sendPrediction(drawId, drawDate, pred) {
    if (lastPrediction && String(lastPrediction.drawId) === String(drawId)) {
        lastPrediction.telegramPredictionQueued = false;
        saveJSON(LAST_PRED_FILE, lastPrediction);
    }
    var cEm = { green: '🟢', red: '🔴', blue: '🔵', yellow: '🟡', SKIP: '⚪', black: '⚫' };
    
    var liveStreaks = loadJSON(STREAKS_FILE, {});
    var mlBz = evaluateMLEntryConfidence('u4', globalTracker.u4.step, pred, liveStreaks);
    var mlRb = evaluateMLEntryConfidence('color', globalTracker.color.step, pred, liveStreaks);
    var mlHl = evaluateMLEntryConfidence('sum', globalTracker.sum.step, pred, liveStreaks);
    var mlTc = evaluateMLEntryConfidence('totalColor', globalTracker.totalColor.step, pred, liveStreaks);
    const mlShadow = {
        u4: getShadowModelDecision('u4', pred, mlBz.score, globalTracker.u4.step),
        color: getShadowModelDecision('color', pred, mlRb.score, globalTracker.color.step),
        sum: getShadowModelDecision('sum', pred, mlHl.score, globalTracker.sum.step),
        totalColor: getShadowModelDecision('totalColor', pred, mlTc.score, globalTracker.totalColor.step)
    };
    const summaryLabelFor = key => {
        const label = getPublicSummaryLabel(mlShadow[key]);
        const summaryStyles = {
            ENTER: '🟢 🚀',
            HOLD: '🟠 ⏸️',
            LEARNING: '🔵 🧠'
        };
        return label ? `\n🧠 <b>SUMMARY</b> ${summaryStyles[label] || '⚪'} <b>${label}</b>` : '';
    };
    var u4Format = pred.betzeroStatus === 'ACTIVE'
        ? `${pred.unlikely4.map(x => getBallEmoji(x.number) + ' <b>' + x.number + '</b>').join(' ')} · Step ${globalTracker.u4.step}${summaryLabelFor('u4')}`
        : `⏳ No pick this draw · Step ${globalTracker.u4.step}`;

    var bet49Format = Number.isInteger(pred.bet49Pick)
        ? `${getBallEmoji(pred.bet49Pick)} <b>${pred.bet49Pick}</b> · Step ${globalTracker.bet49.step}`
        : '⏳ Waiting for enough draw history';

    var rainbowFormat = pred.rainbowStatus === 'ACTIVE'
        ? `${cEm[pred.topColor.name] || '⚪'} <b>${pred.topColor.name.toUpperCase()}</b> · Step ${globalTracker.color.step}${summaryLabelFor('color')}`
        : `⏳ No pick this draw · Step ${globalTracker.color.step}`;

    var tcFormat = pred.totalColorPred.status === 'ACTIVE'
        ? `${cEm[pred.totalColorPred.topColors[0]]} <b>${pred.totalColorPred.topColors[0].toUpperCase()}</b> + ${cEm[pred.totalColorPred.topColors[1]]} <b>${pred.totalColorPred.topColors[1].toUpperCase()}</b> · Avoid ${cEm[pred.totalColorPred.noWinColor]} <b>${pred.totalColorPred.noWinColor.toUpperCase()}</b> · Step ${globalTracker.totalColor.step}${summaryLabelFor('totalColor')}`
        : `⏳ No pick this draw · Step ${globalTracker.totalColor.step}`;

    var tc2Format = pred.totalColor2Pred.status === 'ACTIVE'
        ? `${cEm[pred.totalColor2Pred.top2[0]] || '⚫'} <b>${pred.totalColor2Pred.top2[0].toUpperCase()}</b> + ${cEm[pred.totalColor2Pred.top2[1]] || '⚫'} <b>${pred.totalColor2Pred.top2[1].toUpperCase()}</b> · Step ${globalTracker.totalColor2.step}`
        : '⏳ No pick this draw';

    var hlFormat = pred.hiloStatus === 'ACTIVE'
        ? `${pred.sumRange === 'HIGH' ? '📈' : '📉'} <b>${pred.sumRange}</b> · Step ${globalTracker.sum.step}${summaryLabelFor('sum')}`
        : `⏳ No pick this draw · Step ${globalTracker.sum.step}`;

    let candidateGames = [];
    if (pred.betzeroStatus === 'ACTIVE' && mlBz.recommendation === 'ENTER') {
        candidateGames.push({ key: 'u4', score: mlBz.score });
    }
    if (pred.rainbowStatus === 'ACTIVE') {
        candidateGames.push({ key: 'color', score: mlRb.score });
    }
    if (pred.hiloStatus === 'ACTIVE' && mlHl.recommendation === 'ENTER') {
        candidateGames.push({ key: 'sum', score: mlHl.score });
    }
    if (pred.totalColorPred.status === 'ACTIVE' && mlTc.recommendation === 'ENTER') {
        candidateGames.push({ key: 'totalColor', score: mlTc.score });
    }

    var unifiedFormat = '';
    if (candidateGames.length > 0) {
        candidateGames.sort((a, b) => {
            if (b.score !== a.score) {
                return b.score - a.score;
            }
            return Math.random() - 0.5;
        });
        
        let best = candidateGames[0];
        pred.unifiedPick = best;
        const unifiedNames = { u4: 'BetZero', color: 'Rainbow', sum: 'High / Low', totalColor: 'Total Color 3-way' };
        const unifiedPicks = {
            u4: () => pred.unlikely4.map(item => `${getBallEmoji(item.number)} ${item.number}`).join(' '),
            color: () => `${cEm[pred.topColor.name] || '⚪'} ${pred.topColor.name.toUpperCase()}`,
            sum: () => pred.sumRange,
            totalColor: () => `${pred.totalColorPred.topColors.map(color => `${cEm[color] || '⚪'} ${color.toUpperCase()}`).join(' + ')} (avoid ${cEm[pred.totalColorPred.noWinColor] || '⚪'} ${pred.totalColorPred.noWinColor.toUpperCase()})`
        };
        unifiedFormat = `Selected market: <b>${unifiedNames[best.key]}</b>\nPick: <b>${unifiedPicks[best.key]()}</b>${summaryLabelFor(best.key)}`;
    } else {
        pred.unifiedPick = null;
        unifiedFormat = '⏳ No pick this draw';
    }

    const publicSummaryModel = buildPublicSummaryModel(mlShadow, pred.unifiedPick?.key);
    if (lastPrediction && String(lastPrediction.drawId) === String(drawId)) {
        lastPrediction.summaryModel = publicSummaryModel;
        saveJSON(LAST_PRED_FILE, lastPrediction);
    }

    var lines = [
        `🎯 <b>PICKS · DRAW #${drawId}</b>`,
        `<i>${String(drawDate).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</i>`,
        '',
        `<b>BetZero</b>\n${u4Format}`,
        '',
        `<b>Bet49</b>\n${bet49Format}`,
        '',
        `<b>Rainbow</b>\n${rainbowFormat}`,
        '',
        `<b>Total Color · 3-way</b>\n${tcFormat}`,
        '',
        `<b>Total Color · 2-way</b>\n${tc2Format}`,
        '',
        `<b>High / Low</b>\n${hlFormat}`,
        '',
        `<b>Unified pick</b>\n${unifiedFormat}`
    ];

    const predictionRecord = {
        drawId, drawDate,
        predicted: {
            betzero: pred.betzeroStatus === 'ACTIVE' ? pred.unlikely4.map(x => x.number) : [],
            bet49: Number.isInteger(pred.bet49Pick) ? pred.bet49Pick : null,
            rainbow: pred.rainbowStatus === 'ACTIVE' ? pred.topColor.name : 'SKIP',
            totalColor: pred.totalColorPred,
            totalColor2: pred.totalColor2Pred,
            hilo: pred.hiloStatus === 'ACTIVE' ? pred.sumRange : 'SKIP',
            unified: pred.unifiedPick || null
        },
        steps: {
            betzero: globalTracker.u4.step,
            bet49: globalTracker.bet49.step,
            rainbow: globalTracker.color.step,
            totalColor: globalTracker.totalColor.step, 
            totalColor2: globalTracker.totalColor2.step,
            hilo: globalTracker.sum.step,
            unified: globalTracker.unified.step
        },
        mlScores: { betzero: mlBz.score, rainbow: mlRb.score, hilo: mlHl.score, totalColor: mlTc.score },
        mlShadow,
        summaryModel: publicSummaryModel,
        brainData: pred.brainData,
        result: null, timestamp: new Date().toISOString()
    };
    const existingRecord = predictionLog.find(record => String(record.drawId) === String(drawId));
    if (existingRecord) {
        const existingResult = existingRecord.result;
        Object.assign(existingRecord, predictionRecord);
        if (existingResult) existingRecord.result = existingResult;
    } else {
        predictionLog.unshift(predictionRecord);
    }
    saveJSON(PREDICTIONS_FILE, predictionLog);
    const predictionQueued = !TOKEN || !CHANNEL_CHAT_ID
        ? true
        : queueTelegramPrediction(drawId, lines.join('\n'));
    if (lastPrediction && String(lastPrediction.drawId) === String(drawId)) {
        lastPrediction.telegramPredictionQueued = predictionQueued;
        saveJSON(LAST_PRED_FILE, lastPrediction);
    }
    if (predictionQueued) await flushTelegramPredictionOutbox();
}

function apiPost(path, body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(Object.assign({ tmp: nowISO() }, body));
        const req = http.request({
            hostname: 'localhost', port: 3000, path: path, method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        }, (res) => {
            let data = ''; res.on('data', c => data += c);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
        });
        req.on('error', err => reject(err)); req.write(payload); req.end();
    });
}

function apiGet(path) {
    return new Promise((resolve) => {
        http.get({ hostname: 'localhost', port: 3000, path: path }, (res) => {
            let data = ''; res.on('data', c => data += c);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { resolve({ draws: [] }); } });
        }).on('error', () => resolve({ draws: [] }));
    });
}

function computePredictions(histRaw, stats24Num, stats100Num, stats24HiLo, stats100HiLo, stats100TC, targetDrawId) {
    var validBzNumbers = [];
    var bet49Pick = null;
    var betzeroStatus = 'SKIP';
    var unlikely4 = [];
    var bzSkipReason = '';

    if (histRaw && histRaw.data && histRaw.data.draws && histRaw.data.draws.length >= 100) {
        var draws = histRaw.data.draws;
        const lookbacks = [20, 50, 100];
        const weights = { 20: 0.50, 50: 0.30, 100: 0.20 };
        const localStats = {};

        for (let n = 1; n <= 49; n++) {
            localStats[n] = { strk: 0, counts: { 20: 0, 50: 0, 100: 0 }, riskScore: 0, lowRiskWindows: 0 };
        }

        // Measure appearance risk consistently across short, medium, and long windows.
        for (let i = 0; i < 100; i++) {
            const nums = (draws[i].dr || '').split(',').map(Number).filter(n => n >= 1 && n <= 49);
            nums.forEach(num => {
                if (!localStats[num]) return;
                lookbacks.forEach(window => {
                    if (i < window) localStats[num].counts[window]++;
                });
            });
        }

        for (let n = 1; n <= 49; n++) {
            let currentStreak = 0;
            for (let i = 0; i < 100; i++) {
                const nums = (draws[i].dr || '').split(',').map(Number);
                if (nums.includes(n)) break;
                currentStreak++;
            }
            localStats[n].strk = currentStreak;
        }

        const medians = {};
        lookbacks.forEach(window => {
            const rates = Object.values(localStats)
                .map(stat => (stat.counts[window] / window) * 100)
                .sort((a, b) => a - b);
            medians[window] = rates[Math.floor(rates.length / 2)];
        });

        for (let n = 1; n <= 49; n++) {
            const stat = localStats[n];
            lookbacks.forEach(window => {
                const rate = (stat.counts[window] / window) * 100;
                stat.riskScore += rate * weights[window];
                if (rate <= medians[window]) stat.lowRiskWindows++;
            });

            // Keep the existing absence guard, then require low risk in two windows.
            if (stat.strk >= 4 && stat.lowRiskWindows >= 2) {
                validBzNumbers.push({ number: n, riskScore: stat.riskScore, strk: stat.strk });
            }
        }

        const allSorted = Object.keys(localStats)
            .map(n => ({ number: parseInt(n, 10), riskScore: localStats[n].riskScore, strk: localStats[n].strk }))
            .sort((a, b) => a.riskScore - b.riskScore || b.strk - a.strk);

        // Bet49 is the opposite pick: select the number with the highest weighted
        // appearance rate in the same 20/50/100 draw windows used by BetZero.
        bet49Pick = allSorted.slice().sort((a, b) => b.riskScore - a.riskScore || a.strk - b.strk)[0]?.number ?? null;

        if (validBzNumbers.length >= 4) {
            betzeroStatus = 'ACTIVE';
            validBzNumbers.sort((a, b) => a.riskScore - b.riskScore || b.strk - a.strk);
            unlikely4 = validBzNumbers.slice(0, 4);
        } else {
            betzeroStatus = 'SKIP';
            bzSkipReason = `Only ${validBzNumbers.length}/4 numbers passed the multi-window BetZero filter`;
            unlikely4 = allSorted.slice(0, 4);
        }
    } else {
        bzSkipReason = 'Need at least 100 draws for the BetZero multi-window filter';
        unlikely4 = [{number:1,freq:0},{number:2,freq:0},{number:3,freq:0},{number:4,freq:0}];
    }

    var tc4 = [
        { name: 'green', count: 0 },
        { name: 'red', count: 0 },
        { name: 'blue', count: 0 },
        { name: 'black', count: 0 }
    ];

    if (stats100TC && stats100TC.data && Array.isArray(stats100TC.data.stats)) {
        stats100TC.data.stats.forEach(item => {
            if (item.sel === 'g') tc4.find(x => x.name === 'green').count = parseInt(item.total, 10) || 0;
            if (item.sel === 'r') tc4.find(x => x.name === 'red').count = parseInt(item.total, 10) || 0;
            if (item.sel === 'b') tc4.find(x => x.name === 'blue').count = parseInt(item.total, 10) || 0;
            if (item.sel === 'd') tc4.find(x => x.name === 'black').count = parseInt(item.total, 10) || 0;
        });
    }

    var colorFreqs100 = {
        red: tc4.find(x => x.name === 'red').count,
        blue: tc4.find(x => x.name === 'blue').count,
        green: tc4.find(x => x.name === 'green').count
    };

    var weightedColorCounts = { red: 0, blue: 0, green: 0 };
    var hasFreshColorHistory = false;

    if (histRaw && histRaw.data && Array.isArray(histRaw.data.draws) && histRaw.data.draws.length >= 20) {
        const draws = histRaw.data.draws;
        const windows = [
            { size: 20, weight: 0.50 },
            { size: 50, weight: 0.30 },
            { size: 100, weight: 0.20 }
        ];

        windows.forEach(window => {
            const windowDraws = draws.slice(0, Math.min(window.size, draws.length));
            const colorCounts = { red: 0, blue: 0, green: 0 };

            windowDraws.forEach(draw => {
                const nums = (draw.dr || '').split(',').map(Number).filter(n => n >= 1 && n <= 49);
                nums.forEach(n => {
                    if (n === 49) return;
                    const c = getBallColor(n);
                    if (c === 'red' || c === 'blue' || c === 'green') {
                        colorCounts[c] += 1;
                    }
                });
            });

            const size = Math.max(window.size, 1);
            Object.keys(colorCounts).forEach(color => {
                weightedColorCounts[color] += (colorCounts[color] / size) * window.weight;
            });
        });

        hasFreshColorHistory = true;
    }

    if (!hasFreshColorHistory) {
        weightedColorCounts.red = colorFreqs100.red;
        weightedColorCounts.blue = colorFreqs100.blue;
        weightedColorCounts.green = colorFreqs100.green;
    }

    var rainbowOptions = ['red', 'blue', 'green']
        .map(color => ({ name: color, count: weightedColorCounts[color] }))
        .sort((a, b) => b.count - a.count);

    var rainbowStatus = 'SKIP';
    var rbSkipReason = '';
    var topNonBlack = rainbowOptions[0];
    var secondNonBlack = rainbowOptions[1] || { name: null, count: 0 };
    var thirdNonBlack = rainbowOptions[2] || { name: null, count: 0 };
    var maxFreq100 = topNonBlack ? topNonBlack.count : 0;

    const confidenceGap = Math.max(0, topNonBlack.count - secondNonBlack.count);
    if (topNonBlack && topNonBlack.count > 0 && confidenceGap >= 0.02) {
        rainbowStatus = 'ACTIVE';
    } else if (topNonBlack && topNonBlack.count > 0) {
        rbSkipReason = 'Low color confidence gap or tied top color signal';
    } else {
        rbSkipReason = 'Zero Frequency Data';
    }

    var selectedColorName = topNonBlack ? topNonBlack.name : 'red';
    var rawColorFreq = colorFreqs100[selectedColorName] || 0;
    var topColor = { name: selectedColorName, freq: rawColorFreq, freqs: colorFreqs100, weighted: maxFreq100 };

    var totalColor2Pred = { status: 'SKIP', top2: [], confidence: 0, gap: 0 };
    if (rainbowStatus === 'ACTIVE' && rainbowOptions.length >= 2) {
        totalColor2Pred.status = 'ACTIVE';
        totalColor2Pred.top2 = [rainbowOptions[0].name, rainbowOptions[1].name];
        totalColor2Pred.confidence = Math.max(0, rainbowOptions[0].count - rainbowOptions[1].count);
        totalColor2Pred.gap = Math.max(0, rainbowOptions[0].count - rainbowOptions[1].count);
    }

    var totalColorPred = { status: 'SKIP', topColors: [], noWinColor: null, confidence: 0, gap: 0 };
    if (rainbowStatus === 'ACTIVE' && rainbowOptions.length >= 3) {
        totalColorPred.status = 'ACTIVE';
        totalColorPred.noWinColor = thirdNonBlack.name;
        totalColorPred.topColors = [rainbowOptions[0].name, rainbowOptions[1].name];
        totalColorPred.confidence = Math.max(0, topNonBlack.count - secondNonBlack.count);
        totalColorPred.gap = Math.max(0, topNonBlack.count - secondNonBlack.count);
    } else if (topNonBlack && topNonBlack.count > 0) {
        rbSkipReason = rbSkipReason || 'Insufficient color confidence gap';
    }

    var hiloStatus = 'SKIP';
    var sumRange = 'LOW';
    var oppositeStreakLimit = 0;
    var hlSkipReason = '';
    
    if (histRaw && histRaw.data && histRaw.data.draws && histRaw.data.draws.length >= 20) {
        var recentDraws = histRaw.data.draws.slice(0, 20);
        var recentSums = recentDraws.map(d => parseInt(d.total, 10) || 150);
        var sumTotal = recentSums.reduce((acc, val) => acc + val, 0);
        var movingAverage = sumTotal / recentSums.length;

        var last3 = recentSums.slice(0, 3).map(getSumRange);
        var isChoppy = (last3.includes('HIGH') && last3.includes('LOW') && last3.includes('MID'));

        var h24 = (stats24HiLo && stats24HiLo.data) ? stats24HiLo.data.stats.find(x => x.sel === 'h') || { strk: 0 } : { strk: 0 };
        var l24 = (stats24HiLo && stats24HiLo.data) ? stats24HiLo.data.stats.find(x => x.sel === 'l') || { strk: 0 } : { strk: 0 };
        var hStrk24 = parseInt(h24.strk, 10) || 0;
        var lStrk24 = parseInt(l24.strk, 10) || 0;

        if (isChoppy) {
            hlSkipReason = 'Volatility Filter: Action is too choppy';
        } else if (movingAverage >= 148.0 && movingAverage <= 152.0) {
            hlSkipReason = `Momentum is flat (MA: ${movingAverage.toFixed(1)} trapped in MID zone)`;
        } else if (movingAverage >= 150.0) {
            hiloStatus = 'ACTIVE';
            sumRange = 'HIGH';
            oppositeStreakLimit = lStrk24;
        } else {
            hiloStatus = 'ACTIVE';
            sumRange = 'LOW';
            oppositeStreakLimit = hStrk24;
        }
    } else {
        hlSkipReason = 'Insufficient raw draw history for Momentum calculation';
    }

    var brainData = {
        betzero: { selected: unlikely4.map(x => x.number), status: betzeroStatus, poolSize: validBzNumbers.length },
        rainbow: { selected: topColor.name, freqs: colorFreqs100, maxFreq: rawColorFreq, weightedMax: maxFreq100 },
        hilo: { targetLock: sumRange, oppositeStreakLimit: oppositeStreakLimit },
        totalColor: { status: totalColorPred.status }
    };

    return { 
        unlikely4, betzeroStatus, bzSkipReason, bet49Pick,
        topColor, rainbowStatus, rbSkipReason,
        totalColorPred, 
        totalColor2Pred,
        sumRange, hiloStatus, oppositeStreakLimit, hlSkipReason,
        brainData 
    };
}

function processUpdates(pred, actualDraw) {
    if (!pred || !actualDraw) return;
    if (processedDrawIds.has(String(actualDraw.id))) return;
    processedDrawIds.add(String(actualDraw.id));
    if (processedDrawIds.size > 100) {
        const firstKey = processedDrawIds.values().next().value;
        processedDrawIds.delete(firstKey);
    }

    var actualNums = (actualDraw.dr || '').split(',').map(Number).filter(n => n >= 1 && n <= 49);
    var actualSum = parseInt(actualDraw.total, 10) || 0;
    var actualRange = getSumRange(actualSum);

    var actualColorCounts = { red: 0, blue: 0, green: 0 };
    actualNums.forEach(n => {
        if (n !== 49) {
            let c = getBallColor(n);
            if (actualColorCounts[c] !== undefined) actualColorCounts[c]++;
        }
    });
    var maxActualCount = Math.max(actualColorCounts.red, actualColorCounts.blue, actualColorCounts.green);
    var actualTopColors = Object.keys(actualColorCounts).filter(c => actualColorCounts[c] === maxActualCount);
    
    var tcWin = false;
    if (pred.totalColorPred && pred.totalColorPred.status === 'ACTIVE') {
        tcWin = !(actualTopColors.length === 1 && actualTopColors[0] === pred.totalColorPred.noWinColor);
    }

    var tc2Win = false;
    if (pred.totalColor2Pred && pred.totalColor2Pred.status === 'ACTIVE') {
        let actualOutcomeId = actualTopColors.length === 1 ? actualTopColors[0].toLowerCase() : 'black';
        tc2Win = pred.totalColor2Pred.top2.includes(actualOutcomeId);
    }

    var u4Win = pred.unlikely4.filter(x => new Set(actualNums).has(x.number)).length === 0;
    var bet49Active = Number.isInteger(pred.bet49Pick) && pred.bet49Pick >= 1 && pred.bet49Pick <= 49;
    var bet49Win = bet49Active && actualNums.includes(pred.bet49Pick);
    var colorWin = actualNums.filter(n => getBallColor(n) === pred.topColor.name).length >= 2;
    var sumWin = pred.sumRange === actualRange;

    var unifiedWin = false;
    var unifiedStatus = 'SKIP';
    if (pred.unifiedPick) {
        unifiedStatus = 'ACTIVE';
        if (pred.unifiedPick.key === 'u4') unifiedWin = u4Win;
        else if (pred.unifiedPick.key === 'color') unifiedWin = colorWin;
        else if (pred.unifiedPick.key === 'sum') unifiedWin = sumWin;
        else if (pred.unifiedPick.key === 'totalColor') unifiedWin = tcWin;
    }

    const targetItem = predictionLog.find(p => String(p.drawId) === String(actualDraw.id));
    let savedMl = targetItem ? targetItem.mlScores : { betzero: 0, rainbow: 0, hilo: 0, totalColor: 0 };

    if (targetItem) {
        targetItem.result = {
            balls: actualNums, total: actualSum, range: actualRange,
            betzero: pred.betzeroStatus === 'SKIP' ? 'SKIP' : (u4Win ? 'WIN' : 'LOSS'),
            bet49: Number.isInteger(pred.bet49Pick) ? (bet49Win ? 'WIN' : 'LOSS') : 'SKIP',
            rainbow: pred.rainbowStatus === 'SKIP' ? 'SKIP' : (colorWin ? 'WIN' : 'LOSS'),
            totalColor: pred.totalColorPred.status === 'SKIP' ? 'SKIP' : (tcWin ? 'WIN' : 'LOSS'),
            totalColor2: pred.totalColor2Pred.status === 'SKIP' ? 'SKIP' : (tc2Win ? 'WIN' : 'LOSS'),
            hilo: pred.hiloStatus === 'SKIP' ? 'SKIP' : (sumWin ? 'WIN' : 'LOSS'),
            unified: unifiedStatus === 'SKIP' ? 'SKIP' : (unifiedWin ? 'WIN' : 'LOSS')
        };
        targetItem.settledAt = new Date().toISOString();
        const shadowResultKeys = { u4: 'betzero', color: 'rainbow', sum: 'hilo', totalColor: 'totalColor' };
        for (const [key, resultKey] of Object.entries(shadowResultKeys)) {
            if (targetItem.mlShadow?.[key]) targetItem.mlShadow[key].outcome = targetItem.result[resultKey];
        }
        saveJSON(PREDICTIONS_FILE, predictionLog);
        scheduleRetrainingRefresh(predictionLog.length);
    }

    var mlStreaks = loadJSON(ML_STREAKS_FILE, { u4: { current: 0, worst: 0, w: 0, l: 0 }, color: { current: 0, worst: 0, w: 0, l: 0 }, sum: { current: 0, worst: 0, w: 0, l: 0 }, totalColor: { current: 0, worst: 0, w: 0, l: 0 } });
    
    const updateMLStreak = (key, score, won, status) => {
        if (status === 'SKIP') return;
        if (score >= 0.40) {
            if (won) {
                mlStreaks[key].w++;
                mlStreaks[key].current = 0;
            } else {
                mlStreaks[key].l++;
                mlStreaks[key].current++;
                if (mlStreaks[key].current > mlStreaks[key].worst) mlStreaks[key].worst = mlStreaks[key].current;
            }
        }
    };

    if (pred.betzeroStatus === 'ACTIVE') updateMLStreak('u4', savedMl.betzero, u4Win, pred.betzeroStatus);
    if (pred.rainbowStatus === 'ACTIVE') updateMLStreak('color', savedMl.rainbow, colorWin, pred.rainbowStatus);
    if (pred.hiloStatus === 'ACTIVE') updateMLStreak('sum', savedMl.hilo, sumWin, pred.hiloStatus);
    if (pred.totalColorPred.status === 'ACTIVE') updateMLStreak('totalColor', savedMl.totalColor, tcWin, pred.totalColorPred.status);

    saveJSON(ML_STREAKS_FILE, mlStreaks);

    var s = loadJSON(STREAKS_FILE, {});
    if (!s.u4) s.u4 = { worst: 0, current: 0, consecutiveLosses: 0, cooldown: 0 };
    if (!s.bet49 || !Number.isSafeInteger(s.bet49.worst)) s.bet49 = { ...(s.bet49 || {}), worst: getBet49HistoricalLossStreaks().maximum };
    if (!s.unified) s.unified = { worst: 0, current: 0, consecutiveLosses: 0, cooldown: 0 };
    if (!s.totalColor) s.totalColor = { worst: 0, current: 0, consecutiveLosses: 0, cooldown: 0 };
    if (!s.totalColor2) s.totalColor2 = { worst: 0, current: 0, consecutiveLosses: 0, cooldown: 0 };
    
    if (bet49Active) {
        if (bet49Win) globalTracker.bet49.step = 1;
        else globalTracker.bet49.step++;
    }
    if (pred.betzeroStatus === 'ACTIVE') { 
        updateOneStreakByMode(s, 'u4', 'SAFE', u4Win);
        if (u4Win) globalTracker.u4.step = 1; else globalTracker.u4.step++; 
    }
    if (pred.rainbowStatus === 'ACTIVE') { 
        updateOneStreakByMode(s, 'color', 'SAFE', colorWin);
        if (colorWin) globalTracker.color.step = 1; else globalTracker.color.step++; 
    }
    if (pred.totalColorPred.status === 'ACTIVE') { 
        updateOneStreakByMode(s, 'totalColor', 'SAFE', tcWin);
        if (tcWin) globalTracker.totalColor.step = 1; else globalTracker.totalColor.step++; 
    }
    if (pred.totalColor2Pred.status === 'ACTIVE') { 
        updateOneStreakByMode(s, 'totalColor2', 'SAFE', tc2Win);
        if (tc2Win) globalTracker.totalColor2.step = 1; else globalTracker.totalColor2.step++; 
    }
    if (pred.hiloStatus === 'ACTIVE') { 
        updateOneStreakByMode(s, 'sum', 'SAFE', sumWin);
        if (sumWin) globalTracker.sum.step = 1; else globalTracker.sum.step++; 
    } 
    if (unifiedStatus === 'ACTIVE') { 
        updateOneStreakByMode(s, 'unified', 'SAFE', unifiedWin);
        if (unifiedWin) globalTracker.unified.step = 1; else globalTracker.unified.step++; 
    }

    const applySniperReset = (trackerKey, status, won) => {
        const tracker = globalTracker[trackerKey];
        if (status === 'SKIP') return;

        const outcomeStep = won ? null : tracker.step - 1;
        for (const session of Object.values(userSessions)) {
            const config = session.config;
            const enabledMarket = trackerKey === 'unified'
                ? config.unifiedMode && Object.values(config.enabledGames).some(Boolean)
                : !config.unifiedMode && config.enabledGames[trackerKey];
            const sniper = getSniperSettings(config, trackerKey);
            if (!enabledMarket || !sniper.enabled || sniper.step < 1 || sniper.resetLosses < 1) continue;
            if (String(session.lastBetDrawId) !== String(actualDraw.id)) continue;
            const games = session.lastBetDetails?.games || [];
            const placedMarketBet = trackerKey === 'unified' ? games.length > 0 : games.includes(trackerKey);
            if (!placedMarketBet) continue;

            const state = session.sniperState[trackerKey] || (session.sniperState[trackerKey] = { losses: 0, waitingForTarget: false });
            if (won) {
                state.losses = 0;
                continue;
            }

            if (outcomeStep >= sniper.step) {
                state.losses += 1;
                if (state.losses >= sniper.resetLosses) {
                    state.losses = 0;
                    state.waitingForTarget = true;
                }
            }
        }
    };

    applySniperReset('u4', pred.betzeroStatus, u4Win);
    applySniperReset('color', pred.rainbowStatus, colorWin);
    applySniperReset('totalColor', pred.totalColorPred.status, tcWin);
    applySniperReset('totalColor2', pred.totalColor2Pred.status, tc2Win);
    applySniperReset('sum', pred.hiloStatus, sumWin);
    applySniperReset('unified', unifiedStatus, unifiedWin);

    if (!s.u4) s.u4 = {}; if ((globalTracker.u4.step - 1) > (s.u4.worst || 0)) s.u4.worst = globalTracker.u4.step - 1;
    if (!s.bet49) s.bet49 = {}; if ((globalTracker.bet49.step - 1) > (s.bet49.worst || 0)) s.bet49.worst = globalTracker.bet49.step - 1;
    if (!s.color) s.color = {}; if ((globalTracker.color.step - 1) > (s.color.worst || 0)) s.color.worst = globalTracker.color.step - 1;
    if (!s.totalColor) s.totalColor = {}; if ((globalTracker.totalColor.step - 1) > (s.totalColor.worst || 0)) s.totalColor.worst = globalTracker.totalColor.step - 1;
    if (!s.totalColor2) s.totalColor2 = {}; if ((globalTracker.totalColor2.step - 1) > (s.totalColor2.worst || 0)) s.totalColor2.worst = globalTracker.totalColor2.step - 1;
    if (!s.sum) s.sum = {}; if ((globalTracker.sum.step - 1) > (s.sum.worst || 0)) s.sum.worst = globalTracker.sum.step - 1;
    if (!s.unified) s.unified = {}; if ((globalTracker.unified.step - 1) > (s.unified.worst || 0)) s.unified.worst = globalTracker.unified.step - 1;

    saveJSON(STREAKS_FILE, s);

    let umPredStr = 'SKIP';
    if (pred.unifiedPick) {
        let gName = pred.unifiedPick.key === 'u4' ? 'BetZero' : pred.unifiedPick.key === 'color' ? 'Rainbow' : pred.unifiedPick.key === 'totalColor' ? 'TotalColor3W' : 'HiLo';
        let pickVal = pred.unifiedPick.key === 'u4' 
            ? pred.unlikely4.map(x => x.number).join(' ') 
            : pred.unifiedPick.key === 'color' 
                ? pred.topColor.name.toUpperCase() 
                : pred.unifiedPick.key === 'totalColor'
                    ? pred.totalColorPred.topColors.join(' & ')
                    : pred.sumRange;
        umPredStr = `${gName}: ${pickVal}`;
    }

    pushToGoogleSheet({
        drawId: actualDraw.id, 
        drawDate: new Date().toISOString(), 
        actualBalls: actualNums.join(','),
        
        bzPred: pred.betzeroStatus === 'SKIP' ? 'SKIP' : pred.unlikely4.map(x => x.number).join(' '),
        bet49Pred: bet49Active ? pred.bet49Pick : 'SKIP',
        rbPred: pred.rainbowStatus === 'SKIP' ? 'SKIP' : pred.topColor.name, 
        tcPred: pred.totalColorPred.status === 'SKIP' ? 'SKIP' : `${pred.totalColorPred.topColors.join(' & ').toUpperCase()} + NONE`,
        tc2Pred: pred.totalColor2Pred.status === 'SKIP' ? 'SKIP' : pred.totalColor2Pred.top2.join(' & ').toUpperCase(),
        hlPred: pred.hiloStatus === 'SKIP' ? 'SKIP' : pred.sumRange, 
        umPred: umPredStr,
        
        bzStep: globalTracker.u4.step, 
        bet49Step: globalTracker.bet49.step,
        rbStep: globalTracker.color.step, 
        tcStep: globalTracker.totalColor.step, 
        tc2Step: globalTracker.totalColor2.step,
        hlStep: globalTracker.sum.step, 
        umStep: globalTracker.unified.step,
        
        bzResult: pred.betzeroStatus === 'SKIP' ? 'SKIP' : (u4Win ? 'WIN' : 'LOSS'),
        bet49Result: bet49Active ? (bet49Win ? 'WIN' : 'LOSS') : 'SKIP',
        rbResult: pred.rainbowStatus === 'SKIP' ? 'SKIP' : (colorWin ? 'WIN' : 'LOSS'),
        tcResult: pred.totalColorPred.status === 'SKIP' ? 'SKIP' : (tcWin ? 'WIN' : 'LOSS'),
        tc2Result: pred.totalColor2Pred.status === 'SKIP' ? 'SKIP' : (tc2Win ? 'WIN' : 'LOSS'),
        hlResult: pred.hiloStatus === 'SKIP' ? 'SKIP' : (sumWin ? 'WIN' : 'LOSS'),
        umResult: unifiedStatus === 'SKIP' ? 'SKIP' : (unifiedWin ? 'WIN' : 'LOSS'),
        
        bzMLRec: savedMl.betzero >= 0.50 ? 'ENTER' : 'HOLD', 
        bzMLScore: `${(savedMl.betzero * 100).toFixed(0)}%`, 
        bzMLStreak: mlStreaks.u4.current, 
        bzMLWorst: mlStreaks.u4.worst,

        rbMLRec: pred.rainbowStatus === 'ACTIVE' ? 'ENTER' : 'HOLD', 
        rbMLScore: `${(savedMl.rainbow * 100).toFixed(0)}%`, 
        rbMLStreak: mlStreaks.color.current, 
        rbMLWorst: mlStreaks.color.worst,

        hlMLRec: savedMl.hilo >= 0.55 ? 'ENTER' : 'HOLD', 
        hlMLScore: `${(savedMl.hilo * 100).toFixed(0)}%`, 
        hlMLStreak: mlStreaks.sum.current, 
        hlMLWorst: mlStreaks.sum.worst,
        
        umCurrentStreak: s.unified?.current || 0,
        umMaxLoss: getPublicMarketMaxLosses().unified || 0
    });

    const periodMaxLosses = getPublicMarketMaxLosses();
    const trackerToPublicMarket = {
        u4: 'betzero',
        bet49: 'bet49',
        color: 'rainbow',
        sum: 'hilo',
        totalColor: 'totalColor',
        totalColor2: 'totalColor2',
        unified: 'unified'
    };
    const resultLine = (name, active, won, pick, trackerKey) => {
        const outcome = !active ? '⚪ SKIPPED' : won ? '✅ WIN' : '❌ LOSS';
        const details = active && pick ? ` · ${pick}` : '';
        const stepLabel = active ? 'Next step' : 'Step';
        const marketKey = trackerToPublicMarket[trackerKey];
        return `${outcome} <b>${name}</b>${details} · ${stepLabel} ${globalTracker[trackerKey].step} · Max losses ${periodMaxLosses[marketKey] || 0}`;
    };

    const betzeroPick = pred.betzeroStatus === 'ACTIVE'
        ? pred.unlikely4.map(item => `${getBallEmoji(item.number)} ${item.number}`).join(' ')
        : '';
    const bet49PickText = bet49Active ? `${getBallEmoji(pred.bet49Pick)} ${pred.bet49Pick}` : '';
    const colorEmojis = { red: '🔴', blue: '🔵', green: '🟢', yellow: '🟡', black: '⚫' };
    const rainbowPick = pred.rainbowStatus === 'ACTIVE'
        ? `${colorEmojis[pred.topColor.name] || '⚪'} ${pred.topColor.name.toUpperCase()}`
        : '';
    const tcPick = pred.totalColorPred.status === 'ACTIVE'
        ? `${pred.totalColorPred.topColors.map(color => `${colorEmojis[color] || '⚪'} ${color.toUpperCase()}`).join(' + ')} (avoid ${colorEmojis[pred.totalColorPred.noWinColor] || '⚪'} ${pred.totalColorPred.noWinColor.toUpperCase()})`
        : '';
    const tc2Pick = pred.totalColor2Pred.status === 'ACTIVE'
        ? pred.totalColor2Pred.top2.map(color => `${colorEmojis[color] || '⚪'} ${color.toUpperCase()}`).join(' + ')
        : '';
    const hiloPick = pred.hiloStatus === 'ACTIVE' ? pred.sumRange : '';
    const unifiedName = pred.unifiedPick
        ? ({ u4: 'BetZero', color: 'Rainbow', sum: 'High / Low', totalColor: 'Total Color 3-way' })[pred.unifiedPick.key] || pred.unifiedPick.key
        : '';
    const unifiedPickText = pred.unifiedPick
        ? ({
            u4: betzeroPick,
            color: rainbowPick,
            sum: hiloPick,
            totalColor: tcPick
        })[pred.unifiedPick.key] || ''
        : '';

    var groupReportLines = [
        `🏁 <b>RESULT · DRAW #${actualDraw.id}</b>`,
        `🎱 <b>Numbers:</b> ${actualNums.map(n => getBallEmoji(n) + ' ' + n).join('  ')}`,
        `📊 <b>Total:</b> ${actualSum} · <b>Range:</b> ${actualRange}`,
        '',
        '<b>MARKET RESULTS</b>',
        '',
        resultLine('BetZero', pred.betzeroStatus === 'ACTIVE', u4Win, betzeroPick, 'u4'),
        '',
        resultLine('Bet49', bet49Active, bet49Win, bet49PickText, 'bet49'),
        '',
        resultLine('Rainbow', pred.rainbowStatus === 'ACTIVE', colorWin, rainbowPick, 'color'),
        '',
        resultLine('Total Color · 3-way', pred.totalColorPred.status === 'ACTIVE', tcWin, tcPick, 'totalColor'),
        '',
        resultLine('Total Color · 2-way', pred.totalColor2Pred.status === 'ACTIVE', tc2Win, tc2Pick, 'totalColor2'),
        '',
        resultLine('High / Low', pred.hiloStatus === 'ACTIVE', sumWin, hiloPick, 'sum'),
        '',
        resultLine(`Unified${unifiedName ? ` · ${unifiedName}` : ''}`, unifiedStatus === 'ACTIVE', unifiedWin, unifiedPickText, 'unified')
    ];
    sendTelegram(groupReportLines.join('\n')).catch(() => {});
}

function evaluateSessionBets(clientId, session, pLogItem) {
    if (!session.lastBetDetails || !session.lastBetDrawId) return;
    if (String(session.lastBetDrawId) !== String(pLogItem.drawId)) return;

    const details = session.lastBetDetails;
    const r = pLogItem.result;
    if (!r) return;

    session.lastBetDrawId = null;
    session.lastBetDetails = null;

    let userHadWin = false;
    const u4Win = r.betzero === 'WIN';
    const colorWin = r.rainbow === 'WIN';
    const sumWin = r.hilo === 'WIN';
    const tcWin = r.totalColor === 'WIN';
    const tc2Win = r.totalColor2 === 'WIN';
    const bet49Win = r.bet49 === 'WIN';

    const creditVirtual = (key, stake, odds) => {
        if (!stake || stake <= 0) return;
        const payout = Math.round(stake * odds);
        session.stats.virtualBalance = Math.round(session.stats.virtualBalance + payout);
    };

    if (details.games && details.games.length > 0) {
        if (details.games.includes('u4') && u4Win) { creditVirtual('u4', details.stakes.u4, details.odds.u4 || 1.65); userHadWin = true; }
        if (details.games.includes('bet49') && bet49Win) { creditVirtual('bet49', details.stakes.bet49, details.odds.bet49 || 7.8); userHadWin = true; }
        if (details.games.includes('color') && colorWin) { creditVirtual('color', details.stakes.color, details.odds.color || 1.50); userHadWin = true; }
        if (details.games.includes('sum') && sumWin) { creditVirtual('sum', details.stakes.sum, details.odds.sum || 2.00); userHadWin = true; }
        if (details.games.includes('totalColor') && tcWin) { creditVirtual('totalColor', details.stakes.totalColor, details.odds.totalColor || 3.8); userHadWin = true; }
        if (details.games.includes('totalColor2') && tc2Win) { creditVirtual('totalColor2', details.stakes.totalColor2, details.odds.totalColor2 || 3.8); userHadWin = true; }

        if (userHadWin) {
            session.stats.currentLossStreak = 0;
            session.stats.currentWinStreak++;
            if (session.stats.currentWinStreak > session.stats.maxWinStreak) session.stats.maxWinStreak = session.stats.currentWinStreak;
        } else {
            session.stats.currentWinStreak = 0;
            session.stats.currentLossStreak++;
            if (session.stats.currentLossStreak > session.stats.maxLossStreak) session.stats.maxLossStreak = session.stats.currentLossStreak;
        }
    }

    if (session.stats.initialVirtualBalance != null) {
        session.stats.totalReturned = Math.round(session.stats.virtualBalance - session.stats.initialVirtualBalance);
    }

    session.balanceVerification.pendingWinSync = false;
    session.balanceVerification.refreshClicked = false;

    let progBar = '';
    if (session.config.takeProfit > 0) {
        let pct = Math.max(0, Math.min(100, (session.stats.totalReturned / session.config.takeProfit) * 100));
        let blocks = Math.floor(pct / 10);
        progBar = `\n🎯 <b>Daily Goal:</b> [${'█'.repeat(blocks)}${'░'.repeat(10 - blocks)}] ${pct.toFixed(0)}% (₦${session.stats.totalReturned.toLocaleString()} / ₦${session.config.takeProfit.toLocaleString()})`;
    }
    
    let cbStr = '';
    let highestCb = Math.max(session.cooldowns.unified || 0, session.cooldowns.u4 || 0, session.cooldowns.color || 0, session.cooldowns.sum || 0, session.cooldowns.totalColor || 0, session.cooldowns.totalColor2 || 0);
    if (highestCb > Number(pLogItem.drawId)) {
        let drawsLeft = highestCb - Number(pLogItem.drawId);
        cbStr = `\n🛡️ <b>Circuit Breaker Active:</b> Skipping ${drawsLeft} draws`;
    }

    let displayWins = session.stats.wins + (userHadWin ? 1 : 0);
    let displayLosses = session.stats.losses + (!userHadWin ? 1 : 0);

    const balString = `\n------------------------------------\n📊 <b>Session P/L:</b> ${session.stats.totalReturned >= 0 ? '+' : '-'}₦${Math.abs(session.stats.totalReturned).toLocaleString()}${progBar}\n📈 <b>Record:</b> ${displayWins} Wins | ${displayLosses} Losses${cbStr}\n🔥 <b>Max Win Streak:</b> ${session.stats.maxWinStreak}\n💀 <b>Max Loss Streak:</b> ${session.stats.maxLossStreak}\n\n👤 <b>USER ID:</b> <code>${clientId}</code>\n💳 <b>VIRTUAL BAL:</b> ${session.stats.virtualBalance > 0 ? `₦${session.stats.virtualBalance.toLocaleString()}` : 'Syncing...'} | Live: ₦${(session.stats.liveAccountBalance||0).toLocaleString()}`;

    if (session.config.unifiedMode) {
        const mState = session.masterState;
        const playedKey = mState.lastGamePlayed;
        
        if (playedKey) {
            const isWin = playedKey === 'u4' ? u4Win : playedKey === 'color' ? colorWin : playedKey === 'totalColor' ? tcWin : sumWin;
            const playedOdds = session.wallets[playedKey].odds;
            const gLabel = playedKey === 'u4' ? '🎯 BetZero' : playedKey === 'color' ? '🌈 Rainbow' : playedKey === 'totalColor' ? '🎨 TC (3W)' : '📊 Hi/Lo';
            const currentStake = mState.lastStake;
            const displayStake = playedKey === 'totalColor' ? currentStake * 3 : currentStake;

            const state = session.martingaleState[playedKey];
            
            if (isWin && ((session.config.bzRbRollover && (playedKey === 'u4' || playedKey === 'color' || playedKey === 'sum')) || (session.config.hiloRollover && playedKey === 'sum')) && state && !state.isRollover) {
                state.isRollover = true;
                state.rolloverStake = Math.round(currentStake * playedOdds);
                
                if (session.config.telegramChatId) {
                    sendPersonalDM(session.config.telegramChatId, `🔥 <b>UNIFIED WIN! PREPARING ROLLOVER!</b> — ${gLabel}\n💰 Base Stake Won: <b>₦${currentStake.toLocaleString()}</b>\n⏩ Next Stake (Rollover): <b>₦${state.rolloverStake.toLocaleString()}</b>${balString}`).catch(() => {});
                }
            } 
            else if (isWin && playedKey === 'totalColor' && session.config.tc3Rollover) {
                state.rolloverStage = (state.rolloverStage || 0) + 1;
                
                if (state.rolloverStage < session.config.tc3RolloverTarget) {
                    state.isRollover = true;
                    state.rolloverStake = Math.floor((currentStake * playedOdds) / 3);
                    let totalCompoundCost = state.rolloverStake * 3;
                    
                    session.stats.wins++; session.stats.lastResult = 'win';
                    mState.active = false; mState.step = 1; mState.deficit = 0; mState.lastGamePlayed = null;
                    session.userTracker.unified = { step: 1 };

                    if (session.config.telegramChatId) {
                        sendPersonalDM(session.config.telegramChatId, `🔥 <b>UNIFIED TC3 WIN! COMPOUND HELD (Stage ${state.rolloverStage}/${session.config.tc3RolloverTarget})</b> — ${gLabel}\n💰 Payout Won: <b>₦${Math.round(currentStake * playedOdds).toLocaleString()}</b>\n⏩ Next Rollover Risk (On Next TC3 Trigger): <b>₦${totalCompoundCost.toLocaleString()}</b>${balString}`).catch(() => {});
                    }
                } else {
                    session.stats.wins++; session.stats.lastResult = 'win';
                    state.isRollover = false; state.active = false; state.localStep = 1; state.rolloverStage = 0;
                    mState.active = false; mState.step = 1; mState.deficit = 0; mState.lastGamePlayed = null;
                    session.userTracker.unified = { step: 1 };
                    
                    if (session.config.telegramChatId) {
                        sendPersonalDM(session.config.telegramChatId, `✅ <b>UNIFIED TC3 TARGET SECURED! (Stage ${session.config.tc3RolloverTarget} Hit)</b> — ${gLabel}\n💰 Payout Banked: <b>₦${Math.round(currentStake * playedOdds).toLocaleString()}</b>\n🔄 Resetting to Base Risk!${balString}`).catch(() => {});
                    }
                }
            }
            else if (isWin) {
                session.stats.wins++; session.stats.lastResult = 'win';
                const wasRollover = state ? state.isRollover : false;
                if (state) {
                    state.isRollover = false;
                    if (playedKey === 'totalColor') state.rolloverStage = 0;
                }
                mState.active = false; mState.step = 1; mState.deficit = 0; mState.lastGamePlayed = null;
                session.userTracker.unified = { step: 1 };

                const winMsg = wasRollover ? `✅ <b>UNIFIED ROLLOVER COMPOUND SECURED!</b>` : `✅ <b>UNIFIED WIN!</b>`;

                if (session.config.telegramChatId) {
                    sendPersonalDM(session.config.telegramChatId, `${winMsg} — ${gLabel}\n💰 Stake: <b>₦${displayStake.toLocaleString()}</b>\n🔄 Master Deficit Reset to <b>₦0</b>${balString}`).catch(() => {});
                }
            } else {
                const wasRolloverFailure = (state && state.isRollover);
                if (state) {
                    state.isRollover = false;
                    if (playedKey === 'totalColor') state.rolloverStage = 0;
                }

                session.stats.losses++; session.stats.lastResult = 'loss';
                mState.deficit += displayStake; mState.step++; mState.active = true;
                session.userTracker.unified = { step: mState.step };

                if (session.config.cbMaxLosses > 0 && (mState.step - 1) % session.config.cbMaxLosses === 0) {
                    if (session.config.shadowMode) {
                        mState.inShadowMode = true;
                        if (session.config.telegramChatId) {
                            sendPersonalDM(session.config.telegramChatId, `🛡️ <b>SHADOW MODE ACTIVATED!</b>\n\n⚠️ Reached <b>${session.config.cbMaxLosses} consecutive losses</b> in Unified Master.\n👻 Live betting suspended. Bot is tracking virtual setups and will resume on the next confirmed win.` + balString).catch(() => {});
                        }
                    } else {
                        session.cooldowns.unified = Number(pLogItem.drawId) + session.config.cbCooldown;
                        if (session.config.telegramChatId) {
                            sendPersonalDM(
                                session.config.telegramChatId,
                                `🛡️ <b>CIRCUIT BREAKER TRIGGERED!</b>\n\n` +
                                `⚠️ Reached <b>${session.config.cbMaxLosses} consecutive losses</b> in Unified Master mode.\n` +
                                `⏳ Automation is skipping the next <b>${session.config.cbCooldown} draws</b> to protect your bankroll.\n` +
                                `🕒 Auto-resuming at Draw #${session.cooldowns.unified + 1}` +
                                balString
                            ).catch(() => {});
                        }
                    }
                }

                if (session.config.telegramChatId) {
                    const lossType = wasRolloverFailure ? '❌ <b>UNIFIED ROLLOVER FAILED</b>' : '❌ <b>UNIFIED LOSS</b>';
                    sendPersonalDM(session.config.telegramChatId, `${lossType} — ${gLabel}\n💸 Stake: <b>₦${displayStake.toLocaleString()}</b>\n📉 Current Master Deficit: <b>₦${mState.deficit.toLocaleString()}</b> | Next Master Step: <b>Step ${mState.step}</b>${balString}`).catch(() => {});
                }
            }
            session.stats.betsPlaced++; session.stats.lastStake = displayStake; session.stats.lastOdds = playedOdds;
        }
    } else {
        ['u4', 'bet49', 'color', 'sum', 'totalColor', 'totalColor2'].forEach(key => {
            const state = session.martingaleState[key];
            if (state.active && session.config.enabledGames[key]) {
                if (!details.games?.includes(key)) return;
                const activeWin = key === 'u4' ? u4Win : key === 'bet49' ? r.bet49 === 'WIN' : key === 'color' ? colorWin : key === 'sum' ? sumWin : key === 'totalColor' ? tcWin : tc2Win;
                
                if (key === 'u4' && pLogItem.predicted.betzero === 'SKIP') return;
                if (key === 'bet49' && (!Number.isInteger(Number(pLogItem.predicted.bet49)) || Number(pLogItem.predicted.bet49) < 1 || Number(pLogItem.predicted.bet49) > 49)) return;
                if (key === 'color' && pLogItem.predicted.rainbow === 'SKIP') return;
                if (key === 'sum' && pLogItem.predicted.hilo === 'SKIP') return;
                if (key === 'totalColor' && pLogItem.predicted.totalColor.status === 'SKIP') return;
                if (key === 'totalColor2' && pLogItem.predicted.totalColor2.status === 'SKIP') return;

                let calc = getMartingaleStake(clientId, key, state.localStep);
                const displayStake = (key === 'totalColor') ? (calc.stake * 3) : (key === 'totalColor2') ? (calc.stake * 2) : calc.stake;
                const gLabel = key === 'u4' ? '🎯 BetZero' : key === 'bet49' ? '🟠 Bet49' : key === 'color' ? '🌈 Rainbow' : key === 'sum' ? '📊 Hi/Lo' : key === 'totalColor' ? '🎨 TC (3W)' : '🎭 TC (2W)';

                if (activeWin) {
                    if (((key === 'u4' || key === 'color' || key === 'sum') && session.config.bzRbRollover || key === 'sum' && session.config.hiloRollover) && !state.isRollover) {
                        state.isRollover = true;
                        state.rolloverStake = Math.round(calc.stake * calc.odds);
                        
                        if (session.config.telegramChatId) {
                            sendPersonalDM(session.config.telegramChatId, `🔥 <b>WIN! PREPARING ROLLOVER!</b> — ${gLabel}\n💰 Base Stake Won: <b>₦${displayStake.toLocaleString()}</b>\n⏩ Next Stake (Rollover): <b>₦${state.rolloverStake.toLocaleString()}</b>${balString}`).catch(() => {});
                        }
                    } 
                    else if (key === 'totalColor' && session.config.tc3Rollover) {
                        state.rolloverStage = (state.rolloverStage || 0) + 1;
                        
                        if (state.rolloverStage < session.config.tc3RolloverTarget) {
                            state.isRollover = true;
                            state.rolloverStake = Math.floor((calc.stake * calc.odds) / 3);
                            let totalCompoundCost = state.rolloverStake * 3;
                            
                            if (session.config.telegramChatId) {
                                sendPersonalDM(session.config.telegramChatId, `🔥 <b>TC3 WIN! FULL COMPOUNDING (Stage ${state.rolloverStage}/${session.config.tc3RolloverTarget})</b> — ${gLabel}\n💰 Payout Won: <b>₦${Math.round(calc.stake * calc.odds).toLocaleString()}</b>\n⏩ Next Total Risk: <b>₦${totalCompoundCost.toLocaleString()}</b>${balString}`).catch(() => {});
                            }
                        } else {
                            session.stats.wins++; session.stats.lastResult = 'win';
                            state.isRollover = false; state.active = false; state.localStep = 1; state.rolloverStage = 0;
                            session.userTracker[key].step = 1;
                            
                            if (session.config.telegramChatId) {
                                sendPersonalDM(session.config.telegramChatId, `✅ <b>TC3 TARGET SECURED! (Stage ${session.config.tc3RolloverTarget} Hit)</b> — ${gLabel}\n💰 Payout Banked: <b>₦${Math.round(calc.stake * calc.odds).toLocaleString()}</b>\n🔄 Resetting to Base Risk!${balString}`).catch(() => {});
                            }
                        }
                    } else {
                        session.stats.wins++; session.stats.lastResult = 'win';
                        const wasRollover = state.isRollover;
                        state.isRollover = false; state.active = false; state.localStep = 1; state.rolloverStage = 0;
                        session.userTracker[key].step = 1;

                        const winMsg = wasRollover ? `✅ <b>ROLLOVER COMPOUND SECURED!</b>` : `✅ <b>WIN! TARGET SECURED!</b>`;

                        if (session.config.telegramChatId) {
                            sendPersonalDM(session.config.telegramChatId, `${winMsg} — ${gLabel}\n💰 Stake Executed: <b>₦${displayStake.toLocaleString()}</b>\n🔄 Sequence Reset to Step 1!${balString}`).catch(() => {});
                        }
                    }
                } else {
                    const wasRolloverFailure = state.isRollover;
                    if (wasRolloverFailure) {
                        state.isRollover = false; 
                        state.rolloverStage = 0;
                    }
                    
                    session.stats.losses++; session.stats.lastResult = 'loss';
                    state.localStep++;
                    session.userTracker[key].step = state.localStep;

                    let consecutiveLosses = state.localStep - 1;
                    
                    if (session.config.cbMaxLosses > 0 && consecutiveLosses > 0 && (consecutiveLosses % session.config.cbMaxLosses === 0)) {
                        if (session.config.shadowMode) {
                            state.inShadowMode = true;
                            if (session.config.telegramChatId) {
                                sendPersonalDM(session.config.telegramChatId, `🛡️ <b>SHADOW MODE ACTIVATED!</b> (${gLabel})\n\n⚠️ Reached <b>${session.config.cbMaxLosses} consecutive losses</b>.\n👻 Live betting suspended. Resuming upon next virtual win.` + balString).catch(() => {});
                            }
                        } else {
                            session.cooldowns[key] = Number(pLogItem.drawId) + session.config.cbCooldown;
                            if (session.config.telegramChatId) {
                                sendPersonalDM(
                                    session.config.telegramChatId,
                                    `🛡️ <b>CIRCUIT BREAKER TRIGGERED!</b> (${gLabel})\n\n` +
                                    `⚠️ Reached <b>${session.config.cbMaxLosses} consecutive losses</b>.\n` +
                                    `⏳ Automation is skipping the next <b>${session.config.cbCooldown} draws</b> on this market.\n` +
                                    `🕒 Auto-resuming at Draw #${session.cooldowns[key] + 1}` +
                                    balString
                                ).catch(() => {});
                            }
                        }
                    }

                    if (session.config.telegramChatId) {
                        const lossType = wasRolloverFailure ? '❌ <b>ROLLOVER FAILED</b>' : '❌ <b>LOSS</b>';
                        sendPersonalDM(session.config.telegramChatId, `${lossType} — ${gLabel}\n💸 Failed Stake: <b>₦${displayStake.toLocaleString()}</b> | Next Local Step: <b>${state.localStep}</b>${balString}`).catch(() => {});
                    }
                }
                session.stats.betsPlaced++; session.stats.lastStake = displayStake; session.stats.lastOdds = calc.odds;
            }
        });
    }
}

async function tick() {
    try {
        flushTelegramPredictionOutbox().catch(error => {
            console.error('[Telegram] Prediction outbox could not be flushed:', error.message || error);
        });
        var tlRaw = await apiPost('/Games/Balls49/TimeLeft', { gameId: GAME_ID }).catch(() => null);
        var nextId = String((tlRaw && tlRaw.data) ? tlRaw.data.id : '');
        var drawDate = ((tlRaw && tlRaw.data) ? tlRaw.data.drawDate : '').replace('T', ' ').slice(0, 16);
        
        var timeLeft = 45;
        if (tlRaw && tlRaw.data && typeof tlRaw.data.timeLeft !== 'undefined') {
            timeLeft = parseInt(tlRaw.data.timeLeft, 10);
        }
        if (isNaN(timeLeft)) timeLeft = 45;

        const authoritativeTimeLeft = Number(tlRaw?.data?.timeLeft);
        if (nextId && Number.isFinite(authoritativeTimeLeft) && authoritativeTimeLeft >= 0) {
            publicClock = {
                drawId: nextId,
                timeLeftSeconds: Math.floor(authoritativeTimeLeft),
                drawDate: tlRaw.data.drawDate || null,
                observedAt: Date.now()
            };
        }

        if (!nextId) return;
        
        for (const clientId in userSessions) {
            const session = userSessions[clientId];
            // 🛡️ SHADOW MODE LOGIC (Updated for Deficit Recovery)
            if (session.config.shadowMode) {
                ['u4', 'bet49', 'color', 'sum', 'totalColor', 'totalColor2'].forEach(k => {
                    if (session.martingaleState[k].inShadowMode && globalTracker[k].step === 1) {
                        session.martingaleState[k].inShadowMode = false;
                        
                        if (session.config.telegramChatId) {
                            sendPersonalDM(
                                session.config.telegramChatId, 
                                `✅ <b>SHADOW MODE LIFTED!</b> (${k.toUpperCase()})\n\n` +
                                `🚀 Virtual win confirmed. Resuming live execution at <b>Local Step ${session.martingaleState[k].localStep}</b> to recover prior deficit.`
                            ).catch(() => {});
                        }
                    }
                });
                
                if (session.masterState.inShadowMode && globalTracker.unified.step === 1) {
                    session.masterState.inShadowMode = false;
                    
                    if (session.config.telegramChatId) {
                        sendPersonalDM(
                            session.config.telegramChatId, 
                            `✅ <b>SHADOW MODE LIFTED!</b> (Unified Master)\n\n` +
                            `🚀 Virtual win confirmed. Resuming live execution at <b>Unified Step ${session.masterState.step}</b> with a live deficit of <b>₦${session.masterState.deficit.toLocaleString()}</b> pending recovery.`
                        ).catch(() => {});
                    }
                }
            }

            if (session.pendingBetPayload && String(session.pendingBetPayload.drawId) === nextId && session.pendingBetPayload.action === "EXECUTE_BET") {
                if (timeLeft <= 15) {
                    session.pendingBetPayload = null;
                    session.failedBetRecovery = null;
                    if (session.config.telegramChatId) {
                        sendPersonalDM(session.config.telegramChatId, `🚨 <b>Bet Placement Timeout!</b>\n\nFailed to place bet for Draw #${nextId}. Time dropped below 15 seconds. Bet cancelled to protect sequence.`).catch(()=>{});
                    }
                }
            }
            
            if (session.balanceVerification.pendingWinSync) {
                if (session.stats.liveAccountBalance > session.balanceVerification.balanceBeforeWin) {
                    session.balanceVerification.pendingWinSync = false;
                } else if (timeLeft <= 22 && timeLeft > 15 && !session.balanceVerification.refreshClicked && !session.pendingBetPayload) {
                    session.balanceVerification.refreshClicked = true;
                    session.pendingBetPayload = { action: "REFRESH_BALANCE", drawId: nextId };
                } else if (timeLeft <= 15 && session.balanceVerification.skippedDraw !== nextId) {
                    if (session.config.telegramChatId) {
                        sendPersonalDM(session.config.telegramChatId, `⏳ <b>Balance Sync Lag</b>\n\nWaiting for previous win payout. Skipping Draw #${nextId} to protect bankroll.`).catch(()=>{});
                    }
                    session.balanceVerification.skippedDraw = nextId;
                }
            }
        }

        var drawsData = await apiGet('/draws');
        var draws = drawsData.draws || [];

        if (lastPrediction && lastPrediction.telegramPredictionQueued !== true) {
            const hasLegacyPredictionRecord = lastPrediction.telegramPredictionQueued === undefined
                && predictionLog.some(record => String(record.drawId) === String(lastPrediction.drawId));
            if (hasLegacyPredictionRecord) {
                lastPrediction.telegramPredictionQueued = true;
                saveJSON(LAST_PRED_FILE, lastPrediction);
            } else {
                await sendPrediction(lastPrediction.drawId, lastPrediction.drawDate || drawDate, lastPrediction.pred);
            }
        }

        if (draws.length > 0 && predictionLog.length > 0) {
            let updatedLog = false;
            predictionLog.forEach(p => {
                if (!p.result) {
                    const m = draws.find(d => String(d.id) === String(p.drawId));
                    if (m) {
                        var actualNums = (m.dr || '').split(',').map(Number).filter(n => n >= 1 && n <= 49);
                        var actualSum = parseInt(m.total, 10) || 0;
                        var actualRange = getSumRange(actualSum);

                        var actualColorCounts = { red: 0, blue: 0, green: 0 };
                        actualNums.forEach(n => {
                            if (n !== 49) {
                                let c = getBallColor(n);
                                if (actualColorCounts[c] !== undefined) actualColorCounts[c]++;
                            }
                        });
                        var maxActualCount = Math.max(actualColorCounts.red, actualColorCounts.blue, actualColorCounts.green);
                        var actualTopColors = Object.keys(actualColorCounts).filter(c => actualColorCounts[c] === maxActualCount);

                        var u4Win = (p.predicted.betzero && p.predicted.betzero.length > 0) ? (p.predicted.betzero.filter(x => new Set(actualNums).has(x)).length === 0) : false;
                        var bet49Win = Number.isInteger(Number(p.predicted.bet49)) && actualNums.includes(Number(p.predicted.bet49));
                        var colorWin = (p.predicted.rainbow && p.predicted.rainbow !== 'SKIP') ? (actualNums.filter(n => getBallColor(n) === p.predicted.rainbow).length >= 2) : false;
                        var tcWin = false;
                        if (p.predicted.totalColor && p.predicted.totalColor.status === 'ACTIVE') {
                            tcWin = !(actualTopColors.length === 1 && actualTopColors[0] === p.predicted.totalColor.noWinColor);
                        }
                        var tc2Win = false;
                        if (p.predicted.totalColor2 && p.predicted.totalColor2.status === 'ACTIVE') {
                            let act = actualTopColors.length === 1 ? actualTopColors[0].toLowerCase() : 'black';
                            tc2Win = p.predicted.totalColor2.top2.includes(act);
                        }
                        var sumWin = (p.predicted.hilo && p.predicted.hilo !== 'SKIP') ? (p.predicted.hilo === actualRange) : false;

                        var unifiedWin = false;
                        if (p.predicted.unified) {
                            if (p.predicted.unified.key === 'u4') unifiedWin = u4Win;
                            else if (p.predicted.unified.key === 'color') unifiedWin = colorWin;
                            else if (p.predicted.unified.key === 'sum') unifiedWin = sumWin;
                            else if (p.predicted.unified.key === 'totalColor') unifiedWin = tcWin;
                        }

                        p.result = {
                            balls: actualNums, total: actualSum, range: actualRange,
                            betzero: (!p.predicted.betzero || p.predicted.betzero.length === 0) ? 'SKIP' : (u4Win ? 'WIN' : 'LOSS'),
                            bet49: Number.isInteger(Number(p.predicted.bet49)) && Number(p.predicted.bet49) >= 1 && Number(p.predicted.bet49) <= 49 ? (bet49Win ? 'WIN' : 'LOSS') : 'SKIP',
                            rainbow: (!p.predicted.rainbow || p.predicted.rainbow === 'SKIP') ? 'SKIP' : (colorWin ? 'WIN' : 'LOSS'),
                            totalColor: (!p.predicted.totalColor || p.predicted.totalColor.status === 'SKIP') ? 'SKIP' : (tcWin ? 'WIN' : 'LOSS'),
                            totalColor2: (!p.predicted.totalColor2 || p.predicted.totalColor2.status === 'SKIP') ? 'SKIP' : (tc2Win ? 'WIN' : 'LOSS'),
                            hilo: (!p.predicted.hilo || p.predicted.hilo === 'SKIP') ? 'SKIP' : (sumWin ? 'WIN' : 'LOSS'),
                            unified: !p.predicted.unified ? 'SKIP' : (unifiedWin ? 'WIN' : 'LOSS')
                        };
                        p.settledAt = new Date().toISOString();
                        updatedLog = true;
                    }
                }
            });
            if (updatedLog) saveJSON(PREDICTIONS_FILE, predictionLog);
        }

        if (lastPrediction && draws.length > 0) {
            const matched = draws.find(d => String(d.id) === String(lastPrediction.drawId));
            if (matched) { processUpdates(lastPrediction.pred, matched); lastPrediction = null; try { fs.unlinkSync(LAST_PRED_FILE); } catch (e) {} }
        }

        for (const clientId in userSessions) {
            const session = userSessions[clientId];
            if (session.lastBetDetails && session.lastBetDrawId) {
                const pLogItem = predictionLog.find(p => String(p.drawId) === String(session.lastBetDrawId));
                if (pLogItem && pLogItem.result) {
                    evaluateSessionBets(clientId, session, pLogItem);
                }
            }
        }

        if (lastPrediction && nextId && Number(nextId) >= Number(lastPrediction.drawId) + 2) { lastPrediction = null; try { fs.unlinkSync(LAST_PRED_FILE); } catch (e) {} }

        if (nextId && nextId !== lastGlobalDrawId && !lastPrediction) {
            var stats24Num = await apiPost('/Games/Balls49/Statistics', { pff: 1, gameId: GAME_ID, btc: BTC_NUM, period: '24HRS' }).catch(() => null);
            var stats100Num = await apiPost('/Games/Balls49/Statistics', { pff: 1, gameId: GAME_ID, btc: BTC_NUM, period: '100' }).catch(() => null);
            var stats24HiLo = await apiPost('/Games/Balls49/Statistics', { pff: 1, gameId: GAME_ID, btc: 11050, period: '24HRS' }).catch(() => null);
            var stats100HiLo = await apiPost('/Games/Balls49/Statistics', { pff: 1, gameId: GAME_ID, btc: 11050, period: '100' }).catch(() => null);
            var stats100TC = await apiPost('/Games/Balls49/Statistics', { pff: 1, gameId: GAME_ID, btc: BTC_TC, period: '100' }).catch(() => null);
            var drawsForPred = await apiGet('/draws');

            var pred = computePredictions({ data: { draws: drawsForPred.draws || [] } }, stats24Num, stats100Num, stats24HiLo, stats100HiLo, stats100TC, nextId);
            
            lastPrediction = { drawId: nextId, pred: pred };
            saveJSON(LAST_PRED_FILE, lastPrediction);

            await sendPrediction(nextId, drawDate, pred);
            lastGlobalDrawId = nextId;
        }

        if (lastPrediction && String(lastPrediction.drawId) === String(nextId)) {
            let pred = lastPrediction.pred;
            let liveStreaks = loadJSON(STREAKS_FILE, {});
            let localMlScores = {
                u4: evaluateMLEntryConfidence('u4', globalTracker.u4.step, pred, liveStreaks).score,
                color: evaluateMLEntryConfidence('color', globalTracker.color.step, pred, liveStreaks).score,
                sum: evaluateMLEntryConfidence('sum', globalTracker.sum.step, pred, liveStreaks).score,
                totalColor: evaluateMLEntryConfidence('totalColor', globalTracker.totalColor.step, pred, liveStreaks).score
            };

            const clearStrandedStates = (sess) => {
                ['u4', 'bet49', 'color', 'sum', 'totalColor', 'totalColor2'].forEach(k => {
                    sess.martingaleState[k].isRollover = false;
                    sess.martingaleState[k].rolloverStake = 0;
                    sess.martingaleState[k].localStep = 1;
                    sess.martingaleState[k].active = false;
                    sess.martingaleState[k].rolloverStage = 0;
                });
                sess.masterState.active = false;
                sess.masterState.step = 1;
                sess.masterState.deficit = 0;
                sess.masterState.lastGamePlayed = null;
            };

            for (const clientId in userSessions) {
                const session = userSessions[clientId];
                
                if (session.stats.isHalted || session.pendingBetPayload || session.balanceVerification.pendingWinSync) continue;
                if (session.lastBetDrawId === String(nextId) || session.balanceVerification.skippedDraw === String(nextId)) continue;
                if (session.failedBetRecovery && String(session.failedBetRecovery.payload?.drawId) === String(nextId)) continue;
                if (timeLeft <= 15) continue;

                const balStringHalt = session.stats.liveAccountBalance > 0
                    ? `\n\n👤 <b>USER ID:</b> <code>${clientId}</code>\n💳 <b>LIVE BALANCE:</b> ₦${session.stats.liveAccountBalance.toLocaleString()}`
                    : `\n\n👤 <b>USER ID:</b> <code>${clientId}</code>\n💳 <b>LIVE BALANCE:</b> Syncing...`;

                if (session.config.takeProfit > 0 && session.stats.totalReturned >= session.config.takeProfit) {
                    session.stats.isHalted = true;
                    session.stats.haltReason = `🎯 Target Met (₦${session.config.takeProfit})`;
                    clearStrandedStates(session);
                    if (session.config.telegramChatId) sendPersonalDM(session.config.telegramChatId, `🎯 <b>Balls49 — Target Met!</b>\n\nProfit target reached. Automation paused.${balStringHalt}`).catch(() => {});
                    continue;
                }
                if (session.config.stopLoss < 0 && session.stats.totalReturned <= session.config.stopLoss) {
                    session.stats.isHalted = true;
                    session.stats.haltReason = `🛑 Stop Loss Hit (₦${session.config.stopLoss})`;
                    clearStrandedStates(session);
                    if (session.config.telegramChatId) sendPersonalDM(session.config.telegramChatId, `🛑 <b>Balls49 — Limits Bound!</b>\n\nStop boundary hit. Automation paused.${balStringHalt}`).catch(() => {});
                    continue;
                }
                if (isTimeUp(session.config.schedule)) continue;

                if (session.config.unifiedMode) {
                    if (session.masterState.inShadowMode) continue;

                    let globalPick = pred.unifiedPick; 

                    if (!globalPick && session.config.mlOverrideMode) {
                        if (pred.betzeroStatus === 'ACTIVE') globalPick = { key: 'u4' };
                        else if (pred.rainbowStatus === 'ACTIVE') globalPick = { key: 'color' };
                        else if (pred.hiloStatus === 'ACTIVE') globalPick = { key: 'sum' };
                        else if (pred.totalColorPred.status === 'ACTIVE') globalPick = { key: 'totalColor' };
                    }

                    if (globalPick && !passesSummaryModelGate(session, globalPick.key, pred, localMlScores[globalPick.key] || 0)) continue;
                    
                    let isUnifiedCoolingDown = false;
                    if (session.cooldowns.unified >= Number(nextId)) {
                        isUnifiedCoolingDown = true;
                    } else if (session.cooldowns.unified > 0 && session.cooldowns.unified < Number(nextId)) {
                        session.cooldowns.unified = 0;
                        if (session.config.telegramChatId) {
                            sendPersonalDM(
                                session.config.telegramChatId,
                                `✅ <b>CIRCUIT BREAKER EXPIRED!</b>\n\n` +
                                `🚀 Unified Master mode has completed its skip sequence and resumed active market scanning.`
                            ).catch(() => {});
                        }
                    }

                    if (!sniperAllowsEntry(session, 'unified')) continue;

                    if (globalPick && session.config.enabledGames[globalPick.key] && !isUnifiedCoolingDown
                        && String(session.lastBetDrawId) !== String(nextId)) {
                        
                        let bestGame = globalPick.key;
                        let bestMlScore = localMlScores[bestGame] || 0;

                        if (session.config.maxSteps[bestGame] > 0 && session.masterState.step > session.config.maxSteps[bestGame]) {
                            session.stats.isHalted = true;
                            session.stats.haltReason = `🛑 Max Step Hit (${session.config.maxSteps[bestGame]}) for ${bestGame}`;
                            clearStrandedStates(session);
                            if (session.config.telegramChatId) {
                                sendPersonalDM(session.config.telegramChatId, `🛑 <b>Balls49 — Max Step Hit!</b>\n\nUnified sequence breached Step ${session.config.maxSteps[bestGame]} for target ${bestGame}. Automation paused.`).catch(() => {});
                            }
                            continue;
                        }

                        let computedStake = getUnifiedMasterStake(clientId, bestGame, bestMlScore);

                        session.masterState.lastGamePlayed = bestGame;
                        session.masterState.lastStake = computedStake;

                        const emitU4 = bestGame === 'u4' && computedStake > 0 && pred.betzeroStatus === 'ACTIVE';
                        const emitColor = bestGame === 'color' && computedStake > 0 && pred.rainbowStatus === 'ACTIVE';
                        const emitSum = bestGame === 'sum' && computedStake > 0 && pred.hiloStatus === 'ACTIVE';
                        const emitTotalColor = bestGame === 'totalColor' && computedStake > 0 && pred.totalColorPred.status === 'ACTIVE';

                        session.pendingBetPayload = {
                            action: "EXECUTE_BET",
                            drawId: nextId,
                            numbers: emitU4 ? pred.unlikely4.map(x => x.number) : null,
                            stake: emitU4 ? computedStake : 0,
                            color: emitColor ? pred.topColor.name : null,
                            colorStake: emitColor ? computedStake : 0,
                            sumRange: emitSum ? pred.sumRange : null,
                            sumStake: emitSum ? computedStake : 0,
                            lastHiLoWon: session.martingaleState.sum.isRollover,
                            previousHiLoStake: session.martingaleState.sum.isRollover ? (session.masterState.lastGamePlayed === 'sum' ? session.masterState.lastStake : session.martingaleState.sum.lastStandardStake || Math.round(session.martingaleState.sum.rolloverStake / (session.config.hiloMultiplier || 2.0))) : 0,
                            totalColor: emitTotalColor ? pred.totalColorPred.topColors : null,
                            tcStake: emitTotalColor ? computedStake : 0,
                            steps: {
                                betzero: session.martingaleState.u4.isRollover ? 'ROLLOVER' : session.masterState.step,
                                rainbow: session.martingaleState.color.isRollover ? 'ROLLOVER' : session.masterState.step,
                                hilo: session.martingaleState.sum.isRollover ? 'ROLLOVER' : session.masterState.step,
                                totalColor: session.martingaleState.totalColor.isRollover ? 'ROLLOVER' : session.masterState.step
                            }
                        };
                        if (exceedsStopLossWithPayload(session, session.pendingBetPayload)) {
                            haltForPayloadRisk(session, clientId, session.pendingBetPayload);
                            continue;
                        }
                    }
                } else {
                    let payloadStakes = { u4: 0, bet49: 0, color: 0, sum: 0, totalColor: 0, totalColor2: 0 };
                    let payloadGenerated = false;

                    ['u4', 'bet49', 'color', 'sum', 'totalColor', 'totalColor2'].forEach(key => {
                        if (session.config.enabledGames[key]) {
                            const state = session.martingaleState[key];
                            if (state.inShadowMode) return;
                            
                            let isCoolingDown = false;
                            if (session.cooldowns[key] >= Number(nextId)) {
                                isCoolingDown = true;
                            } else if (session.cooldowns[key] > 0 && session.cooldowns[key] < Number(nextId)) {
                                session.cooldowns[key] = 0;
                                if (session.config.telegramChatId) {
                                    sendPersonalDM(
                                        session.config.telegramChatId,
                                        `✅ <b>CIRCUIT BREAKER EXPIRED!</b> (${key.toUpperCase()})\n\n` +
                                        `🚀 Market cooldown completed. Execution resumed.`
                                    ).catch(() => {});
                                }
                            }

                            if (!sniperAllowsEntry(session, key)) return;

                            if (session.config.maxSteps[key] > 0 && state.localStep > session.config.maxSteps[key]) {
                                session.stats.isHalted = true;
                                session.stats.haltReason = `🛑 Max Step Reached (${session.config.maxSteps[key]})`;
                                clearStrandedStates(session);
                                if (session.config.telegramChatId) {
                                    sendPersonalDM(session.config.telegramChatId, `🛑 <b>Balls49 — Limits Bound!</b>\n\nMax Step (${session.config.maxSteps[key]}) hit for ${key}. Automation paused.`).catch(() => {});
                                }
                                return;
                            }
                            
                            let isActivePrediction = false;
                            let activeMlScore = 0;
                            if (key === 'u4' && pred.betzeroStatus === 'ACTIVE' && (session.config.mlOverrideMode || localMlScores.u4 >= 0.50)) { isActivePrediction = true; activeMlScore = localMlScores.u4; }
                            if (key === 'bet49' && Number.isInteger(pred.bet49Pick) && pred.bet49Pick >= 1 && pred.bet49Pick <= 49) { isActivePrediction = true; }
                            if (key === 'color' && pred.rainbowStatus === 'ACTIVE') { isActivePrediction = true; activeMlScore = localMlScores.color; }
                            if (key === 'sum' && pred.hiloStatus === 'ACTIVE' && (session.config.mlOverrideMode || localMlScores.sum >= 0.55)) { isActivePrediction = true; activeMlScore = localMlScores.sum; }
                            if (key === 'totalColor' && pred.totalColorPred.status === 'ACTIVE' && (session.config.mlOverrideMode || localMlScores.totalColor >= 0.45)) { isActivePrediction = true; activeMlScore = localMlScores.totalColor; }
                            if (key === 'totalColor2' && pred.totalColor2Pred.status === 'ACTIVE') { isActivePrediction = true; activeMlScore = 0; }

                            if (isActivePrediction && !passesSummaryModelGate(session, key, pred, activeMlScore)) {
                                isActivePrediction = false;
                            }

                            if (isActivePrediction && !isCoolingDown) {
                                if (!state.active) {
                                    state.active = true;
                                }
                                const stakeResult = getMartingaleStake(clientId, key, state.localStep, activeMlScore);
                                if (stakeResult && Number(stakeResult.stake) > 0) {
                                    payloadStakes[key] = stakeResult.stake;
                                    payloadGenerated = true;
                                }
                            } 
                        }
                    });

                    if (session.stats.isHalted) continue; 

                    if (payloadGenerated && String(session.lastBetDrawId) !== String(nextId)) {
                        const bzStake = Math.max(0, Number(payloadStakes.u4) || 0);
                        const bet49Stake = Math.max(0, Number(payloadStakes.bet49) || 0);
                        const rbStake = Math.max(0, Number(payloadStakes.color) || 0);
                        const hlStake = Math.max(0, Number(payloadStakes.sum) || 0);
                        const tcStake = Math.max(0, Number(payloadStakes.totalColor) || 0);
                        const tc2Stake = Math.max(0, Number(payloadStakes.totalColor2) || 0);

                        const hasBetZero = session.config.enabledGames.u4 && pred.betzeroStatus === 'ACTIVE' && bzStake > 0;
                        const hasBet49 = session.config.enabledGames.bet49 && Number.isInteger(pred.bet49Pick) && pred.bet49Pick >= 1 && pred.bet49Pick <= 49 && bet49Stake > 0;
                        const hasRainbow = session.config.enabledGames.color && pred.rainbowStatus === 'ACTIVE' && rbStake > 0;
                        const hasHiLo = session.config.enabledGames.sum && pred.hiloStatus === 'ACTIVE' && hlStake > 0;
                        const hasTotalColor = session.config.enabledGames.totalColor && pred.totalColorPred.status === 'ACTIVE' && tcStake > 0;
                        const hasTotalColor2 = session.config.enabledGames.totalColor2 && pred.totalColor2Pred.status === 'ACTIVE' && tc2Stake > 0;

                        session.pendingBetPayload = {
                            action: "EXECUTE_BET",
                            drawId: nextId,
                            
                            numbers: hasBetZero ? pred.unlikely4.map(x => x.number) : null,
                            stake: hasBetZero ? bzStake : 0,

                            bet49: hasBet49 ? pred.bet49Pick : null,
                            bet49Stake: hasBet49 ? bet49Stake : 0,
                            
                            color: hasRainbow ? pred.topColor.name : null,
                            colorStake: hasRainbow ? rbStake : 0,
                            
                            sumRange: hasHiLo ? pred.sumRange : null,
                            sumStake: hasHiLo ? hlStake : 0,
                            lastHiLoWon: session.martingaleState.sum.isRollover,
                            previousHiLoStake: session.martingaleState.sum.isRollover ? (session.martingaleState.sum.lastStandardStake || Math.round(session.martingaleState.sum.rolloverStake / (session.config.hiloMultiplier || 2.0))) : 0,
                            
                            totalColor: hasTotalColor ? pred.totalColorPred.topColors : null,
                            tcStake: hasTotalColor ? tcStake : 0,
                            
                            totalColor2: hasTotalColor2 ? pred.totalColor2Pred.top2 : null,
                            tc2Stake: hasTotalColor2 ? tc2Stake : 0,
                            
                            steps: {
                                betzero: session.martingaleState.u4.isRollover ? 'ROLLOVER' : session.martingaleState.u4.localStep,
                                bet49: session.martingaleState.bet49.localStep,
                                rainbow: session.martingaleState.color.isRollover ? 'ROLLOVER' : session.martingaleState.color.localStep,
                                hilo: session.martingaleState.sum.isRollover ? 'ROLLOVER' : session.martingaleState.sum.localStep,
                                totalColor: session.martingaleState.totalColor.isRollover ? 'ROLLOVER' : session.martingaleState.totalColor.localStep,
                                totalColor2: session.martingaleState.totalColor2.localStep
                            }
                        };
                        if (exceedsStopLossWithPayload(session, session.pendingBetPayload)) {
                            haltForPayloadRisk(session, clientId, session.pendingBetPayload);
                            continue;
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error('[ERROR] Tick failed:', error.stack || error.message || error);
    }
}

async function handleHttpRequest(req, res) {
    const origin = req.headers.origin;
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const isPredictionIngest = req.method === 'POST' && parsedUrl.pathname === '/internal/prediction-snapshot';
    if (isPredictionIngest && origin) {
        return sendJson(res, 403, { error: 'Prediction ingestion is server-to-server only.' });
    }
    if (origin && !isAllowedApiOrigin(origin)) {
        return sendJson(res, 403, { error: 'Origin is not allowed.' });
    }
    if (SITE_PUBLIC_MODE && req.method !== 'GET' && req.method !== 'OPTIONS' && !origin && !isPredictionIngest) {
        return sendJson(res, 403, { error: 'A trusted website origin is required.' });
    }
    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', SITE_PUBLIC_MODE ? 'Content-Type' : 'Content-Type, Authorization');
    if (!SITE_PUBLIC_MODE && req.headers['access-control-request-private-network'] === 'true') {
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }

    if (req.method === 'OPTIONS') return res.writeHead(204), res.end();

    if (SITE_PUBLIC_MODE && !PUBLIC_SITE_ROUTES.has(`${req.method} ${parsedUrl.pathname}`)) {
        return sendJson(res, 404, { error: 'Not found.' });
    }

    if (isPredictionIngest && SITE_PUBLIC_MODE) {
        const timestamp = String(req.headers['x-prediction-timestamp'] || '');
        const signature = String(req.headers['x-prediction-signature'] || '');
        if (!/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 60000 || !/^[a-f0-9]{64}$/.test(signature)) {
            return sendJson(res, 401, { error: 'Invalid prediction publisher authentication.' });
        }
        let rawBody;
        try { rawBody = await readRequestText(req, 2 * 1024 * 1024); }
        catch { return sendJson(res, 413, { error: 'Prediction snapshot is too large or unreadable.' }); }
        const expectedSignature = crypto.createHmac('sha256', PREDICTION_INGEST_SECRET)
            .update(`${timestamp}.${rawBody}`).digest();
        const receivedSignature = Buffer.from(signature, 'hex');
        if (receivedSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(receivedSignature, expectedSignature)) {
            return sendJson(res, 401, { error: 'Invalid prediction publisher authentication.' });
        }
        let snapshot;
        try { snapshot = JSON.parse(rawBody); }
        catch { return sendJson(res, 400, { error: 'Invalid prediction snapshot.' }); }
        const snapshotAt = Number(snapshot?.snapshotAt);
        const validClock = snapshot?.clock && typeof snapshot.clock === 'object' && !Array.isArray(snapshot.clock);
        const validCurrent = snapshot?.current === null || (snapshot?.current && typeof snapshot.current === 'object'
            && snapshot.current.pred && typeof snapshot.current.pred === 'object' && snapshot.current.drawId !== undefined);
        if (snapshot?.version !== 1 || !Number.isSafeInteger(snapshotAt) || snapshotAt !== Number(timestamp)
            || !validClock || !validCurrent || (snapshot.clock.drawId !== null
                && (!Number.isFinite(Number(snapshot.clock.timeLeftSeconds)) || Number(snapshot.clock.timeLeftSeconds) < 0 || Number(snapshot.clock.timeLeftSeconds) > 300))) {
            return sendJson(res, 400, { error: 'Invalid prediction snapshot.' });
        }
        if (!Array.isArray(snapshot.historyUpdates) || snapshot.historyUpdates.length > 1000) {
            return sendJson(res, 400, { error: 'Invalid prediction history updates.' });
        }
        const updatedDrawIds = new Set();
        const normalizedHistoryUpdates = [];
        for (const record of snapshot.historyUpdates) {
            const drawId = String(record?.drawId ?? '');
            const sortDrawId = Number(drawId);
            if (!/^\d{1,32}$/.test(drawId) || !Number.isSafeInteger(sortDrawId) || updatedDrawIds.has(drawId)
                || !record.predicted || typeof record.predicted !== 'object') {
                return sendJson(res, 400, { error: 'Invalid prediction history update.' });
            }
            updatedDrawIds.add(drawId);
            const safeArray = (value, maximum) => Array.isArray(value) ? value.slice(0, maximum) : [];
            const safeText = (value, maximum = 32) => typeof value === 'string' ? value.slice(0, maximum) : null;
            const result = record.result && typeof record.result === 'object' ? {
                balls: safeArray(record.result.balls, 20).map(Number).filter(value => Number.isInteger(value) && value >= 1 && value <= 49),
                total: Number.isFinite(Number(record.result.total)) && record.result.total !== null ? Number(record.result.total) : null,
                range: safeText(record.result.range),
                betzero: safeText(record.result.betzero), rainbow: safeText(record.result.rainbow),
                bet49: safeText(record.result.bet49),
                totalColor: safeText(record.result.totalColor), totalColor2: safeText(record.result.totalColor2),
                hilo: safeText(record.result.hilo), unified: safeText(record.result.unified)
            } : null;
            normalizedHistoryUpdates.push({
                drawId,
                sortDrawId,
                record: {
                    drawId,
                    drawDate: safeText(record.drawDate, 64),
                    timestamp: safeText(record.timestamp, 64),
                    settledAt: safeText(record.settledAt, 64),
                    summaryModel: buildPublicSummaryModel(record.summaryModel, record.predicted.unified?.key),
                    steps: {
                        bet49: safePublicCount(record.steps?.bet49)
                    },
                    predicted: {
                        betzero: safeArray(record.predicted.betzero, 4).map(Number).filter(value => Number.isInteger(value) && value >= 1 && value <= 49),
                        bet49: Number.isInteger(Number(record.predicted.bet49)) && Number(record.predicted.bet49) >= 1 && Number(record.predicted.bet49) <= 49 ? Number(record.predicted.bet49) : null,
                        rainbow: safeText(record.predicted.rainbow),
                        totalColor: record.predicted.totalColor && typeof record.predicted.totalColor === 'object' ? {
                            status: safeText(record.predicted.totalColor.status),
                            topColors: safeArray(record.predicted.totalColor.topColors, 3).map(value => String(value).slice(0, 20)),
                            noWinColor: safeText(record.predicted.totalColor.noWinColor)
                        } : null,
                        totalColor2: record.predicted.totalColor2 && typeof record.predicted.totalColor2 === 'object' ? {
                            status: safeText(record.predicted.totalColor2.status),
                            top2: safeArray(record.predicted.totalColor2.top2, 2).map(value => String(value).slice(0, 20))
                        } : null,
                        hilo: safeText(record.predicted.hilo),
                        unified: record.predicted.unified?.key ? { key: safeText(String(record.predicted.unified.key)) } : null
                    },
                    result
                }
            });
        }
        try {
            const currentJson = snapshot.current === null ? null : JSON.stringify(snapshot.current);
            const clockJson = JSON.stringify(snapshot.clock);
            siteDb.exec('BEGIN IMMEDIATE');
            try {
                const previousFeed = getPublicPredictionFeedStatement.get();
                if (previousFeed && snapshotAt <= previousFeed.updated_at) {
                    siteDb.exec('ROLLBACK');
                    return sendJson(res, 409, { error: 'A newer prediction snapshot is already stored.' });
                }
                for (const item of normalizedHistoryUpdates) {
                    upsertPublicPredictionHistoryStatement.run(item.drawId, item.sortDrawId, JSON.stringify(item.record));
                }
                savePublicPredictionFeedStatement.run(currentJson, clockJson, '[]', '', snapshotAt);
                siteDb.exec('COMMIT');
            } catch (error) {
                siteDb.exec('ROLLBACK');
                throw error;
            }
            lastPrediction = snapshot.current;
            publicClock = snapshot.clock;
            if (normalizedHistoryUpdates.length) {
                const historyByDrawId = new Map(predictionLog.map(record => [String(record.drawId), record]));
                for (const item of normalizedHistoryUpdates) historyByDrawId.set(item.drawId, item.record);
                predictionLog = [...historyByDrawId.values()].sort((left, right) => Number(right.drawId) - Number(left.drawId));
            }
            return sendJson(res, 200, { ok: true, updatedAt: snapshotAt });
        } catch (error) {
            console.error('[PredictionFeed] Could not store an incoming snapshot.');
            return sendJson(res, 500, { error: 'Prediction snapshot could not be stored.' });
        }
    }
    const clientId = parsedUrl.searchParams.get('clientId');

    if (parsedUrl.pathname === '/auth/signup' && req.method === 'POST') {
        if (!allowSiteAuthAttempt(req, res, [{ scope: 'signup-ip', limit: 120, windowMs: 60 * 60 * 1000 }])) return;
        try {
            const data = await readRequestJson(req);
            const email = String(data.email || '').trim().toLowerCase();
            const password = String(data.password || '');
            if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 10) return sendJson(res, 400, { error: 'Enter a valid email and a password with at least 10 characters.' });
            if (getSiteUser(email)) return sendJson(res, 409, { error: 'An account with this email already exists.' });
            const salt = crypto.randomBytes(16).toString('hex');
            const passwordHash = await new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key.toString('hex'))));
            const user = { email, name: String(data.name || '').trim().slice(0, 100), salt, passwordHash, plan: { tier: 'trial', games: [], expiresAt: null, telegram: false }, expiresAt: 0, createdAt: new Date().toISOString() };
            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = Date.now() + 30 * 86400000;
            siteDb.exec('BEGIN IMMEDIATE');
            try {
                createSiteUser(user);
                siteSessions.create(token, { email, expiresAt });
                siteDb.exec('COMMIT');
            } catch (error) {
                siteDb.exec('ROLLBACK');
                throw error;
            }
            setSessionCookie(res, token, 30 * 86400);
            return sendJson(res, 201, { account: publicAccount({ email }) });
        } catch { return sendJson(res, 400, { error: 'Invalid signup request.' }); }
    }

    if (parsedUrl.pathname === '/auth/login' && req.method === 'POST') {
        try {
            const data = await readRequestJson(req);
            const email = String(data.email || '').trim().toLowerCase();
            if (!allowSiteAuthAttempt(req, res, [
                { scope: 'login-ip', limit: 300, windowMs: 15 * 60 * 1000 },
                { scope: 'login-email', identity: email.slice(0, 254), limit: 10, windowMs: 15 * 60 * 1000 }
            ])) return;
            const user = getSiteUser(email);
            if (!user || !user.salt || !user.passwordHash) return sendJson(res, 401, { error: 'Email or password is incorrect.' });
            const candidate = await new Promise((resolve, reject) => crypto.scrypt(String(data.password || ''), user.salt, 64, (error, key) => error ? reject(error) : resolve(key)));
            if (!crypto.timingSafeEqual(candidate, Buffer.from(user.passwordHash, 'hex'))) return sendJson(res, 401, { error: 'Email or password is incorrect.' });
            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = Date.now() + 30 * 86400000;
            siteSessions.create(token, { email, expiresAt });
            setSessionCookie(res, token, 30 * 86400);
            return sendJson(res, 200, { account: publicAccount({ email }) });
        } catch { return sendJson(res, 400, { error: 'Invalid login request.' }); }
    }

    if (parsedUrl.pathname === '/auth/me' && req.method === 'GET') {
        const session = siteSession(req);
        if (!session || session.admin) return sendJson(res, 401, { error: 'Sign in to view your plan.' });
        return sendJson(res, 200, { account: publicAccount(session) });
    }

    if (parsedUrl.pathname === '/account/stake-plans' && req.method === 'GET') {
        const session = siteSession(req);
        if (!session || session.admin) return sendJson(res, 401, { error: 'Sign in to manage your personal stake plans.' });
        const user = getSiteUser(session.email);
        if (!user) return sendJson(res, 401, { error: 'Your account could not be found. Sign in again.' });
        return sendJson(res, 200, { plans: reconcilePredictionStakePlans(user) });
    }

    if (parsedUrl.pathname === '/account/stake-plan' && req.method === 'POST') {
        const session = siteSession(req);
        if (!session || session.admin) return sendJson(res, 401, { error: 'Sign in to manage your personal stake plans.' });
        const user = getSiteUser(session.email);
        if (!user) return sendJson(res, 401, { error: 'Your account could not be found. Sign in again.' });
        try {
            const data = await readRequestJson(req);
            const market = String(data.market || '');
            const baseAmount = Number(data.baseAmount);
            if (!siteMarkets.includes(market)) return sendJson(res, 400, { error: 'Choose a valid prediction market.' });
            if (!Number.isFinite(baseAmount) || baseAmount < 0.01 || baseAmount > 1_000_000_000) {
                return sendJson(res, 400, { error: 'Enter a base stake of at least ₦0.01 and no more than ₦1,000,000,000.' });
            }
            if (typeof data.locked !== 'boolean') return sendJson(res, 400, { error: 'Choose whether to lock this base stake.' });
            const plans = reconcilePredictionStakePlans(user);
            const existingPlan = plans[market];
            const plan = data.locked
                ? {
                    baseAmount: Math.round(baseAmount * 100) / 100,
                    locked: true,
                    step: 1,
                    lastProcessedDrawId: String(latestSettledPredictionDrawId())
                }
                : {
                    baseAmount: Math.round(baseAmount * 100) / 100,
                    locked: false,
                    step: Number.isSafeInteger(existingPlan?.step) ? existingPlan.step : 1,
                    lastProcessedDrawId: existingPlan?.lastProcessedDrawId || String(latestSettledPredictionDrawId())
                };
            plans[market] = plan;
            user.predictionStakePlans = plans;
            saveSiteUser(user);
            return sendJson(res, 200, { market, plan });
        } catch {
            return sendJson(res, 400, { error: 'The stake plan could not be saved. Please try again.' });
        }
    }

    if (parsedUrl.pathname === '/auth/logout' && req.method === 'POST') {
        const token = sessionToken(req);
        if (token) siteSessions.delete(token);
        clearSessionCookie(res);
        return sendJson(res, 200, { ok: true });
    }

    if (parsedUrl.pathname === '/admin/session' && req.method === 'POST') {
        if (!allowSiteAuthAttempt(req, res, [{ scope: 'admin-key-ip', limit: 20, windowMs: 60 * 60 * 1000 }])) return;
        if (!SITE_ADMIN_KEY) return sendJson(res, 503, { error: 'Set SITE_ADMIN_KEY in the server environment first.' });
        try {
            const data = await readRequestJson(req);
            const supplied = Buffer.from(String(data.key || ''));
            const expected = Buffer.from(SITE_ADMIN_KEY);
            if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return sendJson(res, 401, { error: 'Admin key is incorrect.' });
            const token = crypto.randomBytes(32).toString('hex');
            siteSessions.create(token, { admin: true, previewTier: null, previewGames: [], expiresAt: Date.now() + 8 * 3600000 });
            setSessionCookie(res, token, 8 * 3600);
            return sendJson(res, 200, { ok: true });
        } catch { return sendJson(res, 400, { error: 'Invalid admin request.' }); }
    }

    if (parsedUrl.pathname === '/admin/users' && req.method === 'GET') {
        if (!siteSession(req)?.admin) return sendJson(res, 401, { error: 'Admin sign-in required.' });
        return sendJson(res, 200, { users: getSiteUsers().map(({ email, name, createdAt, plan, expiresAt }) => ({ email, name, createdAt, plan, expiresAt })) });
    }

    if (parsedUrl.pathname === '/admin/reset-market-stats' && req.method === 'POST') {
        if (!siteSession(req)?.admin) return sendJson(res, 401, { error: 'Admin sign-in required.' });
        const resetAt = resetMarketStatsTracking();
        return sendJson(res, 200, { ok: true, resetAt: new Date(resetAt).toISOString() });
    }

    if (parsedUrl.pathname === '/admin/approve' && req.method === 'POST') {
        if (!siteSession(req)?.admin) return sendJson(res, 401, { error: 'Admin sign-in required.' });
        try {
            const data = await readRequestJson(req);
            const email = String(data.email || '').trim().toLowerCase();
            const user = getSiteUser(email);
            const tier = String(data.tier || '');
            const months = Math.max(1, Math.min(12, Number.parseInt(data.months, 10) || 1));
            const games = Array.isArray(data.games) ? [...new Set(data.games.filter(game => siteMarkets.includes(game)))] : [];
            if (!user) return sendJson(res, 404, { error: 'Create the user account before approving it.' });
            if (!['trial', 'premium', 'elite'].includes(tier)) return sendJson(res, 400, { error: 'Choose Trial, Premium, or Elite.' });
            if (tier === 'premium' && !games.length) return sendJson(res, 400, { error: 'Select at least one Premium game.' });
            const expiresAt = Date.now() + months * 30 * 86400000;
            user.plan = { tier, games: tier === 'elite' ? [...siteMarkets] : tier === 'premium' ? games : [], expiresAt, telegram: tier === 'elite' };
            user.expiresAt = expiresAt;
            saveSiteUser(user);
            return sendJson(res, 200, { ok: true, user: { email, plan: user.plan } });
        } catch { return sendJson(res, 400, { error: 'Invalid approval request.' }); }
    }

    if (parsedUrl.pathname === '/admin/preview' && req.method === 'POST') {
        const session = siteSession(req);
        if (!session?.admin) return sendJson(res, 401, { error: 'Admin sign-in required.' });
        try {
            const data = await readRequestJson(req);
            const tier = String(data.tier || 'trial');
            if (!['trial', 'premium', 'elite'].includes(tier)) return sendJson(res, 400, { error: 'Choose Trial, Premium, or Elite.' });
            const games = Array.isArray(data.games) ? [...new Set(data.games.filter(game => siteMarkets.includes(game)))] : [];
            session.previewTier = tier;
            session.previewGames = tier === 'elite' ? [...siteMarkets] : tier === 'premium' ? games : [];
            siteSessions.update(sessionToken(req), session);
            return sendJson(res, 200, { ok: true, tier: session.previewTier, games: session.previewGames });
        } catch { return sendJson(res, 400, { error: 'Invalid preview request.' }); }
    }

    if (parsedUrl.pathname === '/admin/preview' && req.method === 'GET') {
        const session = siteSession(req);
        if (!session?.admin) return sendJson(res, 401, { error: 'Admin sign-in required.' });
        return sendJson(res, 200, { tier: session.previewTier || 'trial', games: session.previewGames || [] });
    }

    if (parsedUrl.pathname === '/admin/logout' && req.method === 'POST') {
        const token = sessionToken(req);
        if (token) siteSessions.delete(token);
        clearSessionCookie(res);
        return sendJson(res, 200, { ok: true });
    }

    if (parsedUrl.pathname === '/update-balance' && req.method === 'POST') {
        let body = ''; req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (clientId && userSessions[clientId] && data && typeof data.balance === 'number') {
                    const session = userSessions[clientId];
                    if (session.stats.initialBalance === null || session.stats.initialBalance === undefined) {
                        session.stats.initialBalance = data.balance;
                    }
                    session.stats.liveAccountBalance = data.balance;

                    if ((session.stats.initialVirtualBalance == null) && data.balance > 0) {
                        session.stats.initialVirtualBalance = data.balance;
                        session.stats.virtualBalance = data.balance;
                    }

                    if (session.stats.initialVirtualBalance != null) {
                        session.stats.totalReturned = Math.round(session.stats.virtualBalance - session.stats.initialVirtualBalance);
                    } else {
                        session.stats.totalReturned = Math.round(data.balance - session.stats.initialBalance);
                    }

                    ['u4', 'bet49', 'color', 'sum', 'totalColor', 'totalColor2'].forEach(key => {
                        session.wallets[key].bankroll = data.balance;
                    });
                }
                res.writeHead(200); return res.end(JSON.stringify({ ok: true }));
            } catch (e) { res.writeHead(400); return res.end(); }
        });
        return;
    }

    if (parsedUrl.pathname === '/global-config' && req.method === 'POST') {
        let body = ''; req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const cfg = JSON.parse(body);
                if (cfg.stakes) {
                    const validateStake = (val) => {
                        const num = parseInt(val, 10);
                        if (isNaN(num) || num < 0) return 0;
                        if (num > 50000) return 50000; 
                        return num;
                    };
                    if (cfg.stakes.betzero !== undefined) globalDefaultStakes.u4 = validateStake(cfg.stakes.betzero);
                    if (cfg.stakes.bet49 !== undefined) globalDefaultStakes.bet49 = validateStake(cfg.stakes.bet49);
                    if (cfg.stakes.rainbow !== undefined) globalDefaultStakes.color = validateStake(cfg.stakes.rainbow);
                    if (cfg.stakes.hilo !== undefined) globalDefaultStakes.sum = validateStake(cfg.stakes.hilo);
                    if (cfg.stakes.totalColor !== undefined) globalDefaultStakes.totalColor = validateStake(cfg.stakes.totalColor);
                    if (cfg.stakes.totalColor2 !== undefined) globalDefaultStakes.totalColor2 = validateStake(cfg.stakes.totalColor2);
                    for (let id in userSessions) {
                        userSessions[id].config.initialStakes.u4 = globalDefaultStakes.u4;
                        userSessions[id].config.initialStakes.bet49 = globalDefaultStakes.bet49;
                        userSessions[id].config.initialStakes.color = globalDefaultStakes.color;
                        userSessions[id].config.initialStakes.sum = globalDefaultStakes.sum;
                        userSessions[id].config.initialStakes.totalColor = globalDefaultStakes.totalColor;
                        userSessions[id].config.initialStakes.totalColor2 = globalDefaultStakes.totalColor2;
                    }
                }
                res.writeHead(200); return res.end(JSON.stringify({ ok: true }));
            } catch (e) { 
                res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid global config' })); 
            }
        });
        return;
    }

    if (parsedUrl.pathname === '/public-history' && req.method === 'GET') {
        const limit = Math.min(1000, Math.max(1, parseInt(parsedUrl.searchParams.get('limit'), 10) || 100));
        const offset = Math.max(0, parseInt(parsedUrl.searchParams.get('offset'), 10) || 0);
        const records = predictionLog.filter(p => p && p.drawId !== undefined && p.drawId !== null && p.result && typeof p.result === 'object');
        const publicPredictions = records.slice(offset, offset + limit).map(p => ({
            drawId: String(p.drawId ?? ''),
            drawDate: p.drawDate || p.timestamp || null,
            status: p.result && typeof p.result === 'object' ? 'SETTLED' : 'PENDING',
            summaryModel: buildPublicSummaryModel(p.mlShadow || p.summaryModel, p.predicted?.unified?.key),
            steps: p.steps && typeof p.steps === 'object' ? {
                bet49: safePublicCount(p.steps.bet49)
            } : null,
            predicted: {
                betzero: Array.isArray(p.predicted?.betzero) ? p.predicted.betzero : [],
                bet49: Number.isInteger(Number(p.predicted?.bet49)) ? Number(p.predicted.bet49) : null,
                rainbow: p.result?.rainbow === 'SKIP' ? 'SKIP' : (p.predicted?.rainbow || 'SKIP'),
                totalColor: p.predicted?.totalColor ? {
                    status: p.predicted.totalColor.status || 'SKIP',
                    topColors: Array.isArray(p.predicted.totalColor.topColors) ? p.predicted.totalColor.topColors : [],
                    noWinColor: p.predicted.totalColor.noWinColor || null
                } : { status: 'SKIP', topColors: [], noWinColor: null },
                totalColor2: p.predicted?.totalColor2 ? {
                    status: p.predicted.totalColor2.status || 'SKIP',
                    top2: Array.isArray(p.predicted.totalColor2.top2) ? p.predicted.totalColor2.top2 : []
                } : { status: 'SKIP', top2: [] },
                hilo: p.result?.hilo === 'SKIP' ? 'SKIP' : (p.predicted?.hilo || 'SKIP'),
                unified: p.predicted?.unified?.key ? { key: String(p.predicted.unified.key) } : null
            },
            result: {
                balls: Array.isArray(p.result?.balls) ? p.result.balls : [],
                total: p.result && p.result.total !== null && p.result.total !== undefined && Number.isFinite(Number(p.result.total))
                    ? Number(p.result.total) : null,
                range: p.result?.range || null,
                betzero: p.result?.betzero || (p.result ? 'SKIP' : 'PENDING'),
                bet49: p.result?.bet49 || (p.result ? 'SKIP' : 'PENDING'),
                rainbow: p.result?.rainbow || (p.result ? 'SKIP' : 'PENDING'),
                totalColor: p.result?.totalColor || (p.result ? 'SKIP' : 'PENDING'),
                totalColor2: p.result?.totalColor2 || (p.result ? 'SKIP' : 'PENDING'),
                hilo: p.result?.hilo || (p.result ? 'SKIP' : 'PENDING'),
                unified: p.result?.unified || (p.result ? 'SKIP' : 'PENDING')
            }
        }));
        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
        });
        return res.end(JSON.stringify({
            generatedAt: new Date().toISOString(),
            total: records.length,
            limit,
            offset,
            predictions: publicPredictions
        }));
    }

    if (parsedUrl.pathname === '/public-current-prediction' && req.method === 'GET') {
        const live = lastPrediction && lastPrediction.pred;
        if (!live || lastPrediction.drawId === undefined || lastPrediction.drawId === null) {
            res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            return res.end(JSON.stringify({ error: 'No current prediction is available yet.' }));
        }
        const logged = predictionLog.find(p => String(p.drawId) === String(lastPrediction.drawId));
        const lastUpdated = logged?.timestamp || logged?.drawDate || null;
        const previousRecord = predictionLog.find(p => p
            && String(p.drawId) !== String(lastPrediction.drawId)
            && p.result && typeof p.result === 'object');
        const publicPrediction = {
            drawId: String(lastPrediction.drawId),
            drawDate: logged?.drawDate || null,
            status: 'PENDING',
            predicted: {
                betzero: live.betzeroStatus === 'ACTIVE' && Array.isArray(live.unlikely4)
                    ? live.unlikely4.map(item => Number(item.number)).filter(number => Number.isInteger(number) && number >= 1 && number <= 49)
                    : [],
                bet49: Number.isInteger(Number(live.bet49Pick)) && Number(live.bet49Pick) >= 1 && Number(live.bet49Pick) <= 49 ? Number(live.bet49Pick) : null,
                rainbow: live.rainbowStatus === 'ACTIVE' ? live.topColor?.name || 'SKIP' : 'SKIP',
                totalColor: {
                    status: live.totalColorPred?.status === 'ACTIVE' ? 'ACTIVE' : 'SKIP',
                    topColors: Array.isArray(live.totalColorPred?.topColors) ? live.totalColorPred.topColors : [],
                    noWinColor: live.totalColorPred?.noWinColor || null
                },
                totalColor2: {
                    status: live.totalColor2Pred?.status === 'ACTIVE' ? 'ACTIVE' : 'SKIP',
                    top2: Array.isArray(live.totalColor2Pred?.top2) ? live.totalColor2Pred.top2 : []
                },
                hilo: live.hiloStatus === 'ACTIVE' ? live.sumRange || 'SKIP' : 'SKIP',
                unified: live.unifiedPick?.key ? { key: String(live.unifiedPick.key) } : null
            }
        };
        const publicPrevious = previousRecord ? {
            drawId: String(previousRecord.drawId),
            drawDate: previousRecord.drawDate || previousRecord.timestamp || null,
            predicted: {
                betzero: previousRecord.result?.betzero === 'SKIP' ? [] : (Array.isArray(previousRecord.predicted?.betzero) ? previousRecord.predicted.betzero : []),
                bet49: Number.isInteger(Number(previousRecord.predicted?.bet49)) ? Number(previousRecord.predicted.bet49) : null,
                rainbow: previousRecord.result?.rainbow === 'SKIP' ? 'SKIP' : (previousRecord.predicted?.rainbow || 'SKIP'),
                totalColor: previousRecord.predicted?.totalColor ? {
                    status: previousRecord.predicted.totalColor.status || 'SKIP',
                    topColors: Array.isArray(previousRecord.predicted.totalColor.topColors) ? previousRecord.predicted.totalColor.topColors : [],
                    noWinColor: previousRecord.predicted.totalColor.noWinColor || null
                } : { status: 'SKIP', topColors: [], noWinColor: null },
                totalColor2: previousRecord.predicted?.totalColor2 ? {
                    status: previousRecord.predicted.totalColor2.status || 'SKIP',
                    top2: Array.isArray(previousRecord.predicted.totalColor2.top2) ? previousRecord.predicted.totalColor2.top2 : []
                } : { status: 'SKIP', top2: [] },
                hilo: previousRecord.result?.hilo === 'SKIP' ? 'SKIP' : (previousRecord.predicted?.hilo || 'SKIP'),
                unified: previousRecord.predicted?.unified?.key ? { key: String(previousRecord.predicted.unified.key) } : null
            },
            result: {
                balls: Array.isArray(previousRecord.result.balls) ? previousRecord.result.balls : [],
                total: previousRecord.result.total !== null && previousRecord.result.total !== undefined
                    && Number.isFinite(Number(previousRecord.result.total)) ? Number(previousRecord.result.total) : null,
                range: previousRecord.result.range || null,
                betzero: previousRecord.result.betzero || 'SKIP',
                bet49: previousRecord.result.bet49 || 'SKIP',
                rainbow: previousRecord.result.rainbow || 'SKIP',
                totalColor: previousRecord.result.totalColor || 'SKIP',
                totalColor2: previousRecord.result.totalColor2 || 'SKIP',
                hilo: previousRecord.result.hilo || 'SKIP',
                unified: previousRecord.result.unified || 'SKIP'
            }
        } : null;
        const selectedMarket = parsedUrl.searchParams.get('market');
        const allowedMarkets = ['betzero', 'bet49', 'rainbow', 'totalColor', 'totalColor2', 'hilo', 'unified'];
        const market = allowedMarkets.includes(selectedMarket) ? selectedMarket : 'betzero';
        const currentSummaryModel = buildPublicSummaryModel(
            logged?.mlShadow || logged?.summaryModel || lastPrediction.summaryModel,
            live.unifiedPick?.key
        );
        publicPrediction.summaryLabel = getPublicSummaryLabelForMarket(currentSummaryModel, market, live.unifiedPick?.key);
        const clockFresh = publicClock.observedAt && Date.now() - publicClock.observedAt <= POLL_SEC * 3000;
        const secondsRemaining = clockFresh
            ? Math.max(0, publicClock.timeLeftSeconds - Math.floor((Date.now() - publicClock.observedAt) / 1000))
            : null;
        const predictionMatchesClock = String(lastPrediction.drawId) === String(publicClock.drawId);
        const session = siteSession(req);
        const account = publicAccount(session);
        const activePlan = account?.plan;
        const planTier = session?.admin ? session.previewTier : activePlan?.tier;
        const planGames = session?.admin ? session.previewGames : activePlan?.games;
        const fullAccess = (planTier === 'elite' || (planTier === 'premium' && planGames?.includes(market)))
            && (session?.admin || (activePlan?.expiresAt && activePlan.expiresAt > Date.now()));
        if (!clockFresh || !predictionMatchesClock || (!fullAccess && (secondsRemaining === null || secondsRemaining > 10 || secondsRemaining === 0))) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            return res.end(JSON.stringify({ prediction: null, previous: publicPrevious, lastUpdated, secondsUntilReveal: secondsRemaining === null ? null : Math.max(0, secondsRemaining - 10), access: { tier: planTier || 'trial', games: planGames || [] } }));
        }
        const suppliedMarketStats = lastPrediction.marketStats?.[market] || {};
        const calculatedMarketStats = buildPublicMarketStats(logged);
        publicPrediction.marketStats = {
            step: safePublicCount(suppliedMarketStats.step ?? calculatedMarketStats[market].step),
            maxLosingStreak: calculatedMarketStats[market].maxLosingStreak
        };
        const selectedPicks = {
            betzero: [], bet49: null, rainbow: 'SKIP',
            totalColor: { status: 'SKIP', topColors: [], noWinColor: null },
            totalColor2: { status: 'SKIP', top2: [] },
            hilo: 'SKIP', unified: null
        };
        const marketAliases = { u4: 'betzero', color: 'rainbow', sum: 'hilo' };
        if (market === 'betzero') selectedPicks.betzero = publicPrediction.predicted.betzero;
        if (market === 'bet49') selectedPicks.bet49 = publicPrediction.predicted.bet49;
        if (market === 'rainbow') selectedPicks.rainbow = publicPrediction.predicted.rainbow;
        if (market === 'totalColor') selectedPicks.totalColor = publicPrediction.predicted.totalColor;
        if (market === 'totalColor2') selectedPicks.totalColor2 = publicPrediction.predicted.totalColor2;
        if (market === 'hilo') selectedPicks.hilo = publicPrediction.predicted.hilo;
        if (market === 'unified' && publicPrediction.predicted.unified) {
            selectedPicks.unified = publicPrediction.predicted.unified;
            const sourceMarket = marketAliases[selectedPicks.unified.key] || selectedPicks.unified.key;
            if (allowedMarkets.includes(sourceMarket) && sourceMarket !== 'unified') {
                selectedPicks[sourceMarket] = publicPrediction.predicted[sourceMarket];
            }
        }
        publicPrediction.predicted = selectedPicks;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ prediction: publicPrediction, previous: publicPrevious, lastUpdated, secondsUntilReveal: 0, access: { tier: planTier || 'trial', games: planGames || [] } }));
    }

    if (parsedUrl.pathname === '/public-clock' && req.method === 'GET') {
        const clockIsFresh = publicClock.observedAt && Date.now() - publicClock.observedAt <= POLL_SEC * 3000;
        res.writeHead(clockIsFresh ? 200 : 503, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
        });
        return res.end(JSON.stringify(clockIsFresh
            ? publicClock
            : { error: 'Live draw clock is not available yet.' }));
    }

    if (parsedUrl.pathname === '/predictions') {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ error: 'Not found' }));
    }

    if (parsedUrl.pathname === '/history') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const validPreds = predictionLog.filter(p => p.result !== null);
        const periods = [10, 50, 100, 200, 500, 1000];
        let historyStats = {};

        const calcStats = (slice) => {
            let st = { u4: { w:0, l:0, s:0 }, color: { w:0, l:0, s:0 }, totalColor: { w:0, l:0, s:0 }, totalColor2: { w:0, l:0, s:0 }, sum: { w:0, l:0, s:0 } };
            slice.forEach(p => {
                const r = p.result;
                if (r.betzero === 'WIN') st.u4.w++; else if (r.betzero === 'LOSS') st.u4.l++; else st.u4.s++;
                if (r.rainbow === 'WIN') st.color.w++; else if (r.rainbow === 'LOSS') st.color.l++; else st.color.s++;
                if (r.totalColor === 'WIN') st.totalColor.w++; else if (r.totalColor === 'LOSS') st.totalColor.l++; else st.totalColor.s++;
                if (r.totalColor2 === 'WIN') st.totalColor2.w++; else if (r.totalColor2 === 'LOSS') st.totalColor2.l++; else st.totalColor2.s++;
                if (r.hilo === 'WIN') st.sum.w++; else if (r.hilo === 'LOSS') st.sum.l++; else st.sum.s++;
            });
            return st;
        };

        historyStats['ALL'] = calcStats(validPreds);
        periods.forEach(n => {
            historyStats[n] = calcStats(validPreds.slice(0, n));
        });
        return res.end(JSON.stringify(historyStats));
    }

    if (parsedUrl.pathname === '/best-steps') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        let wsData = loadJSON(WIN_STEPS_FILE, { u4: {}, color: {}, sum: {}, totalColor: {} });
        const getBest = (map) => {
            let b = '-', m = 0;
            for (let k in map) { if (map[k] > m) { m = map[k]; b = k; } }
            return { step: b, wins: m };
        };
        return res.end(JSON.stringify({
            u4: getBest(wsData.u4 || {}), color: getBest(wsData.color || {}), sum: getBest(wsData.sum || {}), totalColor: getBest(wsData.totalColor || {})
        }));
    }

    if (parsedUrl.pathname === '/export') {
        const preds = predictionLog;
        if (!preds || preds.length === 0) {
            res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="balls49.csv"' });
            return res.end('No calculations available');
        }
        
        const headers = ['Draw ID', 'Date/Time', 'BetZero', 'Rainbow', 'TC (3W)', 'TC (2W)', 'Hi/Lo', 'BZ Step', 'RB Step', 'TC3 Step', 'TC2 Step', 'HL Step', 'Result Balls', 'Total', 'Range', 'BZ Res', 'RB Res', 'TC3 Res', 'TC2 Res', 'HL Res', 'BZ ML Rec', 'BZ ML %', 'RB ML Rec', 'RB ML %', 'HL ML Rec', 'HL ML %', 'TC ML Rec', 'TC ML %'].join(',');
        
        const rows = preds.map(p => {
            const time = p.timestamp ? new Date(p.timestamp).toLocaleString() : '';
            const tcPredStr = p.predicted?.totalColor?.status === 'ACTIVE' ? `${p.predicted.totalColor.topColors.join(' & ')} + NONE` : 'SKIP';
            const tc2PredStr = p.predicted?.totalColor2?.status === 'ACTIVE' ? p.predicted.totalColor2.top2.join(' & ') : 'SKIP';
            
            const bzMlRec = (p.mlScores?.betzero >= 0.50) ? 'ENTER' : 'HOLD';
            const bzMlPct = p.mlScores?.betzero ? `${(p.mlScores.betzero * 100).toFixed(0)}%` : '0%';
            const rbMlRec = (p.predicted?.rainbow && p.predicted.rainbow !== 'SKIP') ? 'ENTER' : 'HOLD';
            const rbMlPct = p.mlScores?.rainbow ? `${(p.mlScores.rainbow * 100).toFixed(0)}%` : '0%';
            const hlMlRec = (p.mlScores?.hilo >= 0.55) ? 'ENTER' : 'HOLD';
            const hlMlPct = p.mlScores?.hilo ? `${(p.mlScores.hilo * 100).toFixed(0)}%` : '0%';
            const tcMlRec = (p.mlScores?.totalColor >= 0.45) ? 'ENTER' : 'HOLD';
            const tcMlPct = p.mlScores?.totalColor ? `${(p.mlScores.totalColor * 100).toFixed(0)}%` : '0%';

            if (!p.result) return [p.drawId, `"${time}"`, `"${(p.predicted?.betzero || []).join(' ')}"`, p.predicted?.rainbow || '', tcPredStr, tc2PredStr, p.predicted?.hilo || '', p.steps?.betzero || '', p.steps?.rainbow || '', p.steps?.totalColor || '', p.steps?.totalColor2 || '', p.steps?.hilo || '', '', '', '', 'PENDING', 'PENDING', 'PENDING', 'PENDING', 'PENDING', bzMlRec, bzMlPct, rbMlRec, rbMlPct, hlMlRec, hlMlPct, tcMlRec, tcMlPct].join(',');
            
            const r = p.result;
            return [p.drawId, `"${time}"`, `"${(p.predicted?.betzero || []).join(' ')}"`, p.predicted?.rainbow || '', tcPredStr, tc2PredStr, p.predicted?.hilo || '', p.steps?.betzero || '', p.steps?.rainbow || '', p.steps?.totalColor || '', p.steps?.totalColor2 || '', p.steps?.hilo || '', `"${(r.balls || []).join(' ')}"`, r.total || '', r.range || '', r.betzero || '', r.rainbow || '', r.totalColor || '', r.totalColor2 || '', r.hilo || '', bzMlRec, bzMlPct, rbMlRec, rbMlPct, hlMlRec, hlMlPct, tcMlRec, tcMlPct].join(',');
        });
        res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="balls49_ledger_${Date.now()}.csv"` });
        return res.end([headers, ...rows].join('\n'));
    }

    if (!clientId) return res.writeHead(400), res.end(JSON.stringify({ error: 'Missing coordinate' }));

    const session = getSession(clientId);
    syncSessionFromParams(session, parsedUrl.searchParams);

    if (parsedUrl.pathname === '/backtest' && req.method === 'GET') {
        const gameKey = parsedUrl.searchParams.get('game') || 'hilo';
        const capital = Math.max(1000, Number(parsedUrl.searchParams.get('capital')) || 100000);
        const basePercent = Math.min(100, Math.max(0.01, Number(parsedUrl.searchParams.get('basePercent')) || 0.5));
        const drawWindow = Math.min(10000, Math.max(1, Number(parsedUrl.searchParams.get('draws')) || 1000));
        const profile = parsedUrl.searchParams.get('profile') || 'conservative';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(runLiveStyleBacktest(gameKey, capital, basePercent, profile, drawWindow)));
    }

    if (parsedUrl.pathname === '/stream') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(session.pendingBetPayload ? session.pendingBetPayload : { action: 'WAIT' }));
    }
    
    else if (parsedUrl.pathname === '/risk-profile' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        let s = loadJSON(STREAKS_FILE, {});
        return res.end(JSON.stringify({
            maxHistoricalSteps: {
                u4: s.u4?.worst || 11,
                bet49: getBet49HistoricalLossStreaks().maximum,
                color: s.color?.worst || 9,
                totalColor: s.totalColor?.worst || 6,
                totalColor2: s.totalColor2?.worst || 12,
                sum: s.sum?.worst || 13,
                unified: s.unified?.worst || 6
            }
        }));
    }
    
    else if (parsedUrl.pathname === '/stats') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        let wsData = loadJSON(WIN_STEPS_FILE, { u4: {}, color: {}, sum: {}, totalColor: {} });
        const getBest = (map) => {
            let b = '-', m = 0;
            for (let k in map) { if (map[k] > m) { m = map[k]; b = k; } }
            return { step: b, wins: m };
        };

        let currentStreaks = loadJSON(STREAKS_FILE, {});
        let lastPredData = loadJSON(LAST_PRED_FILE, null);
        let livePred = lastPredData ? lastPredData.pred : null;

        let mlBz = evaluateMLEntryConfidence('u4', session.userTracker.u4.step, livePred, currentStreaks);
        let mlRb = evaluateMLEntryConfidence('color', session.userTracker.color.step, livePred, currentStreaks);
        let mlHl = evaluateMLEntryConfidence('sum', session.userTracker.sum.step, livePred, currentStreaks);
        let mlTc = evaluateMLEntryConfidence('totalColor', session.userTracker.totalColor.step, livePred, currentStreaks);

        let activeCb = null;
        const currentExpectedDraw = lastGlobalDrawId ? Number(lastGlobalDrawId) + 1 : 0;
        
        if (session.config.unifiedMode) {
            if (session.masterState.inShadowMode) {
                activeCb = { active: true, game: 'Unified Master', mode: 'SHADOW' };
            } else if (session.cooldowns.unified >= currentExpectedDraw && currentExpectedDraw > 0) {
                let drawsLeft = session.cooldowns.unified - currentExpectedDraw + 1;
                activeCb = { active: true, game: 'Unified Master', drawsLeft };
            }
        } else {
            for (let k of ['u4', 'bet49', 'color', 'sum', 'totalColor', 'totalColor2']) {
                if (session.martingaleState[k].inShadowMode) {
                    activeCb = { active: true, game: k, mode: 'SHADOW' };
                    break;
                } else if (session.cooldowns[k] >= currentExpectedDraw && currentExpectedDraw > 0) {
                    let drawsLeft = session.cooldowns[k] - currentExpectedDraw + 1;
                    activeCb = { active: true, game: k, drawsLeft };
                    break;
                }
            }
        }

        let statusDisplay = session.stats.isHalted ? session.stats.haltReason 
            : (activeCb ? (activeCb.mode === 'SHADOW' ? '👻 Shadow Mode Active' : `🛡️ CB Pause (${activeCb.drawsLeft} draws)`) : 'Active');
            
        const retryStatus = session.pendingBetPayload && session.pendingBetPayload.action === "EXECUTE_BET" 
            ? { active: true, retries: session.failedBetRecovery?.retries || 0 } : null;

        const decisionLabels = { u4: 'BetZero', bet49: 'Bet49', color: 'Rainbow', sum: 'Hi/Lo', totalColor: 'Total Color 3-Way', totalColor2: 'Total Color 2-Way' };
        const decisionThresholds = { u4: 0.50, bet49: 0, color: 0, sum: 0.55, totalColor: 0.45, totalColor2: 0 };
        let decisionReason = 'Waiting for the next draw decision.';
        if (session.stats.isHalted) {
            decisionReason = session.stats.haltReason || 'Automation is halted.';
        } else if (activeCb) {
            const cbLabel = decisionLabels[activeCb.game] || activeCb.game;
            decisionReason = activeCb.mode === 'SHADOW'
                ? `${cbLabel} is paused in Shadow Mode until a virtual recovery win.`
                : `${cbLabel} is in circuit-breaker cooldown for ${activeCb.drawsLeft} draw(s).`;
        } else if (session.balanceVerification.pendingWinSync) {
            decisionReason = 'Waiting for the previous win balance to synchronize.';
        } else if (session.pendingBetPayload) {
            decisionReason = `Bet queued for draw #${session.pendingBetPayload.drawId}.`;
        } else if (livePred) {
            const enabledKeys = ['u4', 'bet49', 'color', 'sum', 'totalColor', 'totalColor2'].filter(key => session.config.enabledGames[key]);
            const predictionByKey = {
                u4: livePred.betzeroStatus,
                bet49: Number.isInteger(livePred.bet49Pick) && livePred.bet49Pick >= 1 && livePred.bet49Pick <= 49 ? 'ACTIVE' : 'SKIP',
                color: livePred.rainbowStatus,
                sum: livePred.hiloStatus,
                totalColor: livePred.totalColorPred?.status,
                totalColor2: livePred.totalColor2Pred?.status
            };
            const skipReasons = { u4: livePred.bzSkipReason, color: livePred.rbSkipReason, sum: livePred.hlSkipReason };
            const mlScores = { u4: mlBz.score, bet49: 1, color: mlRb.score, sum: mlHl.score, totalColor: mlTc.score, totalColor2: 1 };
            const blockedKey = enabledKeys.find(key => predictionByKey[key] === 'SKIP');
            const summaryHoldKey = enabledKeys.find(key => SUMMARY_MODEL_MARKETS.includes(key)
                && session.config.summaryModelMarkets?.[key]
                && predictionByKey[key] === 'ACTIVE'
                && getShadowModelDecision(key, livePred, mlScores[key], globalTracker[key]?.step || 1).recommendation !== 'ENTER');
            const thresholdKey = enabledKeys.find(key => predictionByKey[key] === 'ACTIVE' && !session.config.mlOverrideMode && mlScores[key] < decisionThresholds[key]);
            const readyKey = enabledKeys.find(key => predictionByKey[key] === 'ACTIVE' && (session.config.mlOverrideMode || mlScores[key] >= decisionThresholds[key]));
            if (!enabledKeys.length) {
                decisionReason = 'No prediction market is enabled.';
            } else if (blockedKey) {
                decisionReason = `${decisionLabels[blockedKey]} is skipped${skipReasons[blockedKey] ? `: ${skipReasons[blockedKey]}` : '.'}`;
            } else if (summaryHoldKey) {
                decisionReason = `${decisionLabels[summaryHoldKey]} is held by its enabled summary model gate.`;
            } else if (thresholdKey) {
                decisionReason = `${decisionLabels[thresholdKey]} is held until the confidence model clears the entry gate.`;
            } else if (readyKey) {
                decisionReason = `${decisionLabels[readyKey]} is eligible for the next draw.`;
            } else {
                decisionReason = 'No enabled market currently meets its entry conditions.';
            }
        }

        return res.end(JSON.stringify({
            ...session.stats, status: statusDisplay,
            cbStatus: activeCb,
            retryStatus,
            currentStep: session.config.unifiedMode 
                ? { 
                    u4: session.martingaleState.u4.isRollover ? 'ROLLOVER' : session.masterState.step, 
                    bet49: session.martingaleState.bet49.localStep,
                    color: session.martingaleState.color.isRollover ? 'ROLLOVER' : session.masterState.step, 
                    sum: session.martingaleState.sum.isRollover ? 'ROLLOVER' : session.masterState.step, 
                    totalColor: session.martingaleState.totalColor.isRollover ? 'ROLLOVER' : session.masterState.step, 
                    totalColor2: session.masterState.step 
                  }
                : { 
                    u4: session.martingaleState.u4.isRollover ? 'ROLLOVER' : session.martingaleState.u4.localStep, 
                    bet49: session.martingaleState.bet49.localStep,
                    color: session.martingaleState.color.isRollover ? 'ROLLOVER' : session.martingaleState.color.localStep, 
                    sum: session.martingaleState.sum.isRollover ? 'ROLLOVER' : session.martingaleState.sum.localStep, 
                    totalColor: session.martingaleState.totalColor.isRollover ? 'ROLLOVER' : session.martingaleState.totalColor.localStep, 
                    totalColor2: session.martingaleState.totalColor2.localStep 
                  },
            profit: session.stats.totalReturned, takeProfit: session.config.takeProfit, stopLoss: session.config.stopLoss,
            bestSteps: { u4: getBest(wsData.u4 || {}), color: getBest(wsData.color || {}), sum: getBest(wsData.sum || {}), totalColor: getBest(wsData.totalColor || {}) },
            mlData: { u4: mlBz, color: mlRb, sum: mlHl, totalColor: mlTc },
            decisionReason,
            liveAccountBalance: session.stats.liveAccountBalance || 0,
            virtualBalance: session.stats.virtualBalance || 0
        }));
    }
    else if (parsedUrl.pathname === '/ack' && req.method === 'POST') {
        let body = ''; req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                
                if (data && data.action === 'REFRESH_BALANCE') {
                    if (session.pendingBetPayload && session.pendingBetPayload.action === "REFRESH_BALANCE") {
                        session.pendingBetPayload = null;
                    }
                    res.writeHead(200); return res.end(JSON.stringify({ ok: true }));
                }

                if (data && data.drawId) {
                    if (data.status === 'FAILED') {
                        if (!session.failedBetRecovery) session.failedBetRecovery = { retries: 0 };
                        session.failedBetRecovery.retries += 1;
                        session.pendingBetPayload = null; 
                    } else {
                        const payload = session.pendingBetPayload;
                        let totalStake = 0;
                        const details = { drawId: String(data.drawId), stakes: {}, odds: {}, games: [] };

                        if (payload && payload.action === 'EXECUTE_BET') {
                            if (payload.numbers && payload.stake > 0) {
                                details.stakes.u4 = payload.stake;
                                details.odds.u4 = session.wallets.u4.odds;
                                details.games.push('u4');
                                totalStake += payload.stake;
                            }
                            if (Number.isInteger(payload.bet49) && payload.bet49 >= 1 && payload.bet49 <= 49 && payload.bet49Stake > 0) {
                                details.stakes.bet49 = payload.bet49Stake;
                                details.odds.bet49 = session.wallets.bet49.odds;
                                details.games.push('bet49');
                                totalStake += payload.bet49Stake;
                            }
                            if (payload.color && payload.colorStake > 0) {
                                details.stakes.color = payload.colorStake;
                                details.odds.color = session.wallets.color.odds;
                                details.games.push('color');
                                totalStake += payload.colorStake;
                            }
                            if (payload.sumRange && payload.sumStake > 0) {
                                details.stakes.sum = payload.sumStake;
                                details.odds.sum = session.wallets.sum.odds;
                                details.games.push('sum');
                                totalStake += payload.sumStake;
                            }
                            if (payload.totalColor && payload.tcStake > 0) {
                                details.stakes.totalColor = payload.tcStake;
                                details.odds.totalColor = session.wallets.totalColor.odds;
                                details.games.push('totalColor');
                                totalStake += (payload.tcStake * 3);
                            }
                            if (payload.totalColor2 && payload.tc2Stake > 0) {
                                details.stakes.totalColor2 = payload.tc2Stake;
                                details.odds.totalColor2 = session.wallets.totalColor2.odds;
                                details.games.push('totalColor2');
                                totalStake += (payload.tc2Stake * 2);
                            }
                        }

                        if (totalStake > 0) {
                            if (session.stats.initialVirtualBalance == null) {
                                session.stats.initialVirtualBalance = session.stats.liveAccountBalance || 0;
                                session.stats.virtualBalance = session.stats.initialVirtualBalance;
                            }
                            session.stats.virtualBalance = Math.round(session.stats.virtualBalance - totalStake);
                            session.stats.totalReturned = Math.round(session.stats.virtualBalance - session.stats.initialVirtualBalance);
                        }

                        session.lastBetDetails = details;
                        session.lastBetDrawId = String(data.drawId);
                        session.pendingBetPayload = null;
                        session.failedBetRecovery = null;
                    }
                }
                res.writeHead(200); return res.end(JSON.stringify({ ok: true }));
            } catch (e) { res.writeHead(400); return res.end(); }
        });
    }
    else if (parsedUrl.pathname === '/reset' && req.method === 'POST') {
        session.martingaleState.u4 = { active: false, localStep: 1, isRollover: false, rolloverStake: 0, inShadowMode: false };
        session.martingaleState.bet49 = { active: false, localStep: 1, isRollover: false, rolloverStake: 0, inShadowMode: false };
        session.martingaleState.color = { active: false, localStep: 1, isRollover: false, rolloverStake: 0, inShadowMode: false };
        session.martingaleState.sum = { active: false, localStep: 1, isRollover: false, rolloverStake: 0, lastStandardStake: 0, inShadowMode: false };
        session.martingaleState.totalColor = { active: false, localStep: 1, isRollover: false, rolloverStake: 0, rolloverStage: 0, inShadowMode: false };
        session.martingaleState.totalColor2 = { active: false, localStep: 1, inShadowMode: false };
        session.masterState = { active: false, step: 1, deficit: 0, lastGamePlayed: null, lastStake: 0, inShadowMode: false };
        session.cooldowns = { u4: 0, bet49: 0, color: 0, sum: 0, totalColor: 0, totalColor2: 0, unified: 0 };
        
        session.stats.isHalted = true; 
        session.stats.haltReason = "🛑 Wiped & Stopped by User";
        
        session.pendingBetPayload = null;
        session.failedBetRecovery = null;

        session.userTracker = {
            u4: { step: 1 }, bet49: { step: 1 }, color: { step: 1 }, sum: { step: 1 },
            totalColor: { step: 1 }, totalColor2: { step: 1 }, unified: { step: 1 },
            lastPredDrawId: null
        };

        session.config.initialStakes = { u4: 0, bet49: 0, color: 0, sum: 0, totalColor: 0, totalColor2: 0 };
        session.config.enabledGames = { u4: false, bet49: false, color: false, sum: false, totalColor: false, totalColor2: false };
        session.config.takeProfit = 0;
        session.config.stopLoss = 0;
        
        session.balanceVerification = { pendingWinSync: false, balanceBeforeWin: 0, skippedDraw: null, refreshClicked: false };
        session.lastBetDrawId = null;
        session.lastBetDetails = null;
        
        session.stats.initialBalance = session.stats.liveAccountBalance > 0 ? session.stats.liveAccountBalance : null;
        session.stats.initialVirtualBalance = session.stats.liveAccountBalance > 0 ? session.stats.liveAccountBalance : null;
        session.stats.virtualBalance = session.stats.initialVirtualBalance || 0;
        session.stats.totalReturned = 0; 
        session.stats.wins = 0; session.stats.losses = 0; session.stats.betsPlaced = 0;
        
        session.stats.currentWinStreak = 0; session.stats.maxWinStreak = 0;
        session.stats.currentLossStreak = 0; session.stats.maxLossStreak = 0;

        res.writeHead(200); return res.end(JSON.stringify({ ok: true }));
    }
    else if (parsedUrl.pathname === '/config' && req.method === 'POST') {
        let body = ''; req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const cfg = JSON.parse(body);
                const validateNumber = (val, min = 0, max = null, defaultVal = 0) => {
                    const num = parseInt(val, 10);
                    if (!Number.isSafeInteger(num)) return defaultVal;
                    if (num < min) return min;
                    if (max !== null && num > max) return max;
                    return num;
                };

                session.stats.isHalted = false;
                session.stats.haltReason = "";
                
                if (cfg.running !== undefined && cfg.running === false) {
                    session.stats.isHalted = true;
                    session.stats.haltReason = "🛑 Stopped by User";
                }

                if (cfg.stakes) {
                    if (cfg.stakes.betzero !== undefined) session.config.initialStakes.u4 = validateNumber(cfg.stakes.betzero, 0, 50000, 0);
                    if (cfg.stakes.bet49 !== undefined) session.config.initialStakes.bet49 = validateNumber(cfg.stakes.bet49, 0, 50000, 0);
                    if (cfg.stakes.rainbow !== undefined) session.config.initialStakes.color = validateNumber(cfg.stakes.rainbow, 0, 50000, 0);
                    if (cfg.stakes.hilo !== undefined) session.config.initialStakes.sum = validateNumber(cfg.stakes.hilo, 0, 50000, 0);
                    if (cfg.stakes.totalColor !== undefined) session.config.initialStakes.totalColor = validateNumber(cfg.stakes.totalColor, 0, 50000, 0);
                    if (cfg.stakes.totalColor2 !== undefined) session.config.initialStakes.totalColor2 = validateNumber(cfg.stakes.totalColor2, 0, 50000, 0);
                }
                
                if (cfg.gameSteps) {
                    if (cfg.gameSteps.betzero !== undefined) session.config.maxSteps.u4 = validateNumber(cfg.gameSteps.betzero);
                    if (cfg.gameSteps.bet49 !== undefined) session.config.maxSteps.bet49 = validateNumber(cfg.gameSteps.bet49);
                    if (cfg.gameSteps.rainbow !== undefined) session.config.maxSteps.color = validateNumber(cfg.gameSteps.rainbow);
                    if (cfg.gameSteps.hilo !== undefined) session.config.maxSteps.sum = validateNumber(cfg.gameSteps.hilo);
                    if (cfg.gameSteps.totalColor !== undefined) session.config.maxSteps.totalColor = validateNumber(cfg.gameSteps.totalColor);
                    if (cfg.gameSteps.totalColor2 !== undefined) session.config.maxSteps.totalColor2 = validateNumber(cfg.gameSteps.totalColor2);
                }

                if (cfg.enabledGames) {
                    if (cfg.enabledGames.betzero !== undefined || cfg.enabledGames.u4 !== undefined) {
                        session.config.enabledGames.u4 = Boolean(cfg.enabledGames.betzero || cfg.enabledGames.u4);
                    }
                    if (cfg.enabledGames.bet49 !== undefined) {
                        session.config.enabledGames.bet49 = Boolean(cfg.enabledGames.bet49);
                    }
                    if (cfg.enabledGames.rainbow !== undefined || cfg.enabledGames.color !== undefined) {
                        session.config.enabledGames.color = Boolean(cfg.enabledGames.rainbow || cfg.enabledGames.color);
                    }
                    if (cfg.enabledGames.hilo !== undefined || cfg.enabledGames.sum !== undefined) {
                        session.config.enabledGames.sum = Boolean(cfg.enabledGames.hilo || cfg.enabledGames.sum);
                    }
                    if (cfg.enabledGames.totalColor !== undefined) {
                        session.config.enabledGames.totalColor = Boolean(cfg.enabledGames.totalColor);
                    }
                    if (cfg.enabledGames.totalColor2 !== undefined) {
                        session.config.enabledGames.totalColor2 = Boolean(cfg.enabledGames.totalColor2);
                    }
                }
                if (cfg.takeProfit !== undefined) {
                    const tp = parseInt(cfg.takeProfit, 10);
                    session.config.takeProfit = (isNaN(tp) || tp < 0) ? 0 : Math.min(tp, 10000000); 
                }
                if (cfg.stopLoss !== undefined) {
                    const sl = parseInt(cfg.stopLoss, 10);
                    session.config.stopLoss = (isNaN(sl) || sl > 0) ? 0 : Math.max(sl, -10000000); 
                }
                if (cfg.hiloMultiplier !== undefined) {
                    const hm = parseFloat(cfg.hiloMultiplier);
                    session.config.hiloMultiplier = (isNaN(hm) || hm <= 0) ? 2.0 : hm;
                }
                if (cfg.telegramChatId !== undefined) {
                    const chatId = String(cfg.telegramChatId).trim();
                    if (/^-?\d+$/.test(chatId)) {
                        session.config.telegramChatId = chatId;
                    } else if (chatId === '' || chatId === 'null') {
                        session.config.telegramChatId = null;
                    } else {
                        return res.writeHead(400), res.end(JSON.stringify({ error: 'Invalid Telegram Chat ID format' }));
                    }
                }
                if (cfg.flatBetting !== undefined) session.config.flatBetting = Boolean(cfg.flatBetting);
                if (cfg.sniperSettings && typeof cfg.sniperSettings === 'object') {
                    for (const market of SNIPER_SETTING_MARKETS) {
                        const incoming = cfg.sniperSettings[market] || {};
                        const current = session.config.sniperSettings[market] || { enabled: false, step: 0, resetLosses: 0 };
                        session.config.sniperSettings[market] = {
                            enabled: incoming.enabled === undefined ? current.enabled : Boolean(incoming.enabled),
                            step: incoming.step === undefined ? current.step : validateNumber(incoming.step, 0, 10, 0),
                            resetLosses: incoming.resetLosses === undefined ? current.resetLosses : validateNumber(incoming.resetLosses, 0, 50, 0)
                        };
                    }
                } else if (cfg.sniperMode !== undefined || cfg.sniperStep !== undefined || cfg.sniperResetLosses !== undefined) {
                    // Older extension builds expose one shared sniper profile; apply it to every market.
                    if (cfg.sniperMode !== undefined) session.config.sniperMode = Boolean(cfg.sniperMode);
                    if (cfg.sniperStep !== undefined) session.config.sniperStep = validateNumber(cfg.sniperStep, 0, 10, 0);
                    if (cfg.sniperResetLosses !== undefined) session.config.sniperResetLosses = validateNumber(cfg.sniperResetLosses, 0, 50, 0);
                    const legacy = {
                        enabled: session.config.sniperMode,
                        step: session.config.sniperStep,
                        resetLosses: session.config.sniperResetLosses
                    };
                    session.config.sniperSettings = Object.fromEntries(SNIPER_SETTING_MARKETS.map(market => [market, { ...legacy }]));
                }
                if (cfg.cbMaxLosses !== undefined) session.config.cbMaxLosses = validateNumber(cfg.cbMaxLosses, 0, 50, 0);
                if (cfg.cbCooldown !== undefined) session.config.cbCooldown = validateNumber(cfg.cbCooldown, 0, 300, 0); 
                if (cfg.mlOverrideMode !== undefined) session.config.mlOverrideMode = Boolean(cfg.mlOverrideMode);
                if (cfg.summaryModelMarkets && typeof cfg.summaryModelMarkets === 'object' && !Array.isArray(cfg.summaryModelMarkets)) {
                    for (const market of SUMMARY_MODEL_MARKETS) {
                        if (typeof cfg.summaryModelMarkets[market] === 'boolean') {
                            session.config.summaryModelMarkets[market] = cfg.summaryModelMarkets[market];
                        }
                    }
                }
                if (cfg.unifiedMode !== undefined) session.config.unifiedMode = Boolean(cfg.unifiedMode);
                if (cfg.bzRbRollover !== undefined) session.config.bzRbRollover = Boolean(cfg.bzRbRollover);
                if (cfg.hiloRollover !== undefined) session.config.hiloRollover = Boolean(cfg.hiloRollover);
                if (cfg.tc3Rollover !== undefined) session.config.tc3Rollover = Boolean(cfg.tc3Rollover);
                if (cfg.tc3RolloverTarget !== undefined) session.config.tc3RolloverTarget = validateNumber(cfg.tc3RolloverTarget, 2, 10, 3);
                if (cfg.shadowMode !== undefined) session.config.shadowMode = Boolean(cfg.shadowMode);
                if (cfg.weightedStaking !== undefined) session.config.weightedStaking = Boolean(cfg.weightedStaking);

                res.writeHead(200); return res.end(JSON.stringify({ ok: true }));
            } catch (e) { 
                res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid config format' })); 
            }
        });
    } else { res.writeHead(404); res.end(); }
}

http.createServer((req, res) => {
    handleHttpRequest(req, res).catch(error => {
        console.error(`[HTTP] Request failed: ${error.message || error}`);
        if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error.' });
        else res.destroy();
    });
}).listen(PORT, process.env.HOST || (SITE_PUBLIC_MODE ? '0.0.0.0' : '127.0.0.1'), () => {
    const host = process.env.HOST || (SITE_PUBLIC_MODE ? '0.0.0.0' : '127.0.0.1');
    console.log(`[Server] Core active on ${host}:${PORT}${SITE_PUBLIC_MODE ? ' (public website routes only)' : ' (local mode)'}`);
});

let lastTelegramUpdateId = 0;
const telegramPlanStates = new Map();

function calculatePlanHighLowSteps(initialStake, maxSteps, multiplier) {
    let totalLost = 0;
    let currentBet = initialStake;
    const bets = [];
    const profits = [];

    for (let step = 1; step <= maxSteps; step++) {
        const bet = roundPlanValue(currentBet);
        bets.push(bet);
        profits.push(roundPlanValue((bet * 2) - (totalLost + bet)));
        totalLost += bet;
        currentBet = bet * multiplier;
    }
    return { bets, profits, total: roundPlanValue(totalLost) };
}

function calculatePlanOddsSteps(initialStake, odds, maxSteps) {
    const targetProfit = initialStake * (odds - 1);
    let totalLost = 0;
    const bets = [];
    const profits = [];

    for (let step = 1; step <= maxSteps; step++) {
        const bet = step === 1 ? initialStake : (totalLost + targetProfit) / (odds - 1);
        bets.push(roundPlanValue(bet));
        totalLost += bet;
        profits.push(roundPlanValue(targetProfit));
    }
    return { bets, profits, total: roundPlanValue(totalLost) };
}

function calculatePlanTotalColor(initialStake, maxSteps, twoWay) {
    let totalLost = 0;
    const bets = [];
    const profits = [];
    const costFactor = twoWay ? 2 : 3;

    for (let step = 1; step <= maxSteps; step++) {
        const bet = step === 1
            ? initialStake
            : twoWay
                ? (totalLost + initialStake) / 1.8
                : totalLost / 0.8;
        bets.push(roundPlanValue(bet));
        totalLost += bet * costFactor;
        profits.push(roundPlanValue(twoWay ? (step === 1 ? (bet * 3.8) - (bet * 2) : initialStake) : step === 1 ? (bet * 3.8) - (bet * 3) : 0));
    }
    return { bets, profits, total: roundPlanValue(totalLost) };
}

function roundPlanValue(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function createPlanKeyboard() {
    return {
        inline_keyboard: [
            [{ text: 'BetZero (1.65)', callback_data: 'plan:betzero' }],
            [{ text: 'Rainbow (1.50)', callback_data: 'plan:rainbow' }],
            [{ text: 'High/Low (2x)', callback_data: 'plan:hilo' }],
            [{ text: 'High/Low (1.40x)', callback_data: 'plan:hilo_140' }],
            [{ text: 'Total Color Break-Even (3W)', callback_data: 'plan:total_color' }],
            [{ text: 'Total Color Profit (2W)', callback_data: 'plan:total_color_2way' }],
            [{ text: 'Custom Martingale', callback_data: 'plan:martingale' }]
        ]
    };
}

function telegramApiRequest(method, payload) {
    return new Promise((resolve) => {
        const body = JSON.stringify(payload);
        const req = https.request({
            hostname: 'api.telegram.org', path: `/bot${TOKEN}/${method}`, method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, res => { res.on('data', () => {}); res.on('end', resolve); });
        req.on('error', resolve); req.write(body); req.end();
    });
}

function answerTelegramCallback(callbackQueryId) {
    return telegramApiRequest('answerCallbackQuery', { callback_query_id: callbackQueryId });
}

function sendTelegramPlanMenu(chatId) {
    return telegramApiRequest('sendMessage', {
        chat_id: String(chatId),
        text: '🎯 <b>Choose game strategy:</b>',
        parse_mode: 'HTML',
        reply_markup: createPlanKeyboard()
    });
}

function sendTelegramPlanPrompt(chatId, text) {
    return sendPersonalDM(chatId, text);
}

function formatTelegramPlan(chatId, state, capital) {
    let result;
    if (state.strategy === 'hilo') result = calculatePlanHighLowSteps(state.stake, state.steps, 2);
    else if (state.strategy === 'hilo_140') result = calculatePlanHighLowSteps(state.stake, state.steps, 1.4);
    else if (state.strategy === 'total_color') result = calculatePlanTotalColor(state.stake, state.steps, false);
    else if (state.strategy === 'total_color_2way') result = calculatePlanTotalColor(state.stake, state.steps, true);
    else result = calculatePlanOddsSteps(state.stake, state.odds, state.steps);

    const lines = [
        `📊 <b>${state.name} Sequence</b>`,
        `Target Odds: <b>${state.odds}</b> | Base Unit: <b>₦${state.stake.toLocaleString(undefined, { minimumFractionDigits: 2 })}</b> | Steps: <b>${state.steps}</b>`,
        ''
    ];
    result.bets.forEach((bet, index) => {
        const profit = result.profits[index];
        lines.push(`${index + 1} → ₦${bet.toLocaleString(undefined, { minimumFractionDigits: 2 })}   (${profit >= 0 ? '+' : '-'}₦${Math.abs(profit).toLocaleString(undefined, { minimumFractionDigits: 2 })})`);
    });
    lines.push('', `Total risked across sequence: <b>₦${result.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</b>`);
    if (result.total > capital * 0.8) lines.push('', '🚨 <b>Warning:</b> Total risk exceeds 80% of your declared capital.');
    return sendPersonalDM(chatId, lines.join('\n'));
}

function handleTelegramPlanCallback(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const selection = String(callbackQuery.data || '').replace(/^plan:/, '');
    const definitions = {
        betzero: { name: 'BetZero (1.65 Odds)', odds: 1.65 },
        rainbow: { name: 'Rainbow (1.50 Odds)', odds: 1.5 },
        hilo: { name: 'High/Low (2x Multiplier)', odds: 2 },
        hilo_140: { name: 'High/Low (1.40x Multiplier)', odds: 2 },
        total_color: { name: 'Total Color Break-Even (3W)', odds: 3.8 },
        total_color_2way: { name: 'Total Color Profit (2W)', odds: 3.8 },
        martingale: { name: 'Custom Martingale', odds: null }
    };
    const definition = definitions[selection];
    if (!definition) return answerTelegramCallback(callbackQuery.id);

    telegramPlanStates.set(String(chatId), { state: definition.odds === null ? 'odds' : 'stake', strategy: selection, ...definition });
    answerTelegramCallback(callbackQuery.id);
    return sendTelegramPlanPrompt(chatId, definition.odds === null
        ? `✅ <b>${definition.name}</b> selected\n\nEnter custom odds (e.g. 1.85):`
        : `✅ <b>${definition.name}</b> selected\n\nEnter initial base stake (₦):`);
}

function handleTelegramPlanMessage(chatId, text) {
    const key = String(chatId);
    const plan = telegramPlanStates.get(key);
    if (!plan) return false;
    const value = Number(String(text).trim());

    if (plan.state === 'odds') {
        if (!Number.isFinite(value) || value <= 1) return sendTelegramPlanPrompt(chatId, '❌ Odds must be greater than 1.').then(() => true);
        plan.odds = value; plan.state = 'stake';
        return sendTelegramPlanPrompt(chatId, `✅ Odds set to <b>${value}</b>\n\nEnter initial base stake (₦):`).then(() => true);
    }
    if (plan.state === 'stake') {
        if (!Number.isFinite(value) || value <= 0) return sendTelegramPlanPrompt(chatId, '❌ Please enter a valid positive stake.').then(() => true);
        plan.stake = value; plan.state = 'steps';
        return sendTelegramPlanPrompt(chatId, `✅ Base Stake: ₦${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n\nHow many Martingale steps? Enter a positive whole number.`).then(() => true);
    }
    if (plan.state === 'steps') {
        if (!Number.isSafeInteger(value) || value < 1) return sendTelegramPlanPrompt(chatId, '❌ Enter a positive whole-number step count.').then(() => true);
        plan.steps = value; plan.state = 'capital';
        return sendTelegramPlanPrompt(chatId, '✅ Steps set\n\nEnter total available capital (₦):').then(() => true);
    }
    if (plan.state === 'capital') {
        if (!Number.isFinite(value) || value <= 0) return sendTelegramPlanPrompt(chatId, '❌ Please enter a valid positive capital amount.').then(() => true);
        telegramPlanStates.delete(key);
        return formatTelegramPlan(chatId, plan, value).then(() => true);
    }
    return false;
}

async function pollTelegramCommands() {
    if (!TOKEN) return;
    try {
        https.get(`https://api.telegram.org/bot${TOKEN}/getUpdates?offset=${lastTelegramUpdateId + 1}&timeout=5`, (res) => {
            let data = ''; res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.ok && parsed.result.length > 0) {
                        for (let update of parsed.result) {
                            lastTelegramUpdateId = update.update_id;
                            if (update.callback_query) handleTelegramPlanCallback(update.callback_query);
                            if (update.message && update.message.text) {
                                const hasActivePlan = telegramPlanStates.has(String(update.message.chat.id));
                                if (hasActivePlan) handleTelegramPlanMessage(update.message.chat.id, update.message.text);
                                else handleTelegramCommand(update.message.chat.id, update.message.text);
                            }
                        }
                    }
                } catch (e) {}
            });
        }).on('error', () => {});
    } catch (e) {}
    setTimeout(pollTelegramCommands, 3000);
}

function handleTelegramCommand(chatId, text) {
    const rawCmd = text.trim();
    const parts = rawCmd.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    let targetSession = null;
    for (let cid in userSessions) {
        if (String(userSessions[cid].config.telegramChatId) === String(chatId)) { 
            targetSession = userSessions[cid]; 
            break; 
        }
    }

    if (!targetSession) {
        sendPersonalDM(chatId, "⚠️ <b>Chat ID not linked.</b> Save your Chat ID in the extension options first.").catch(() => {});
        return;
    }

    const config = targetSession.config;
    const stats = targetSession.stats;
    const balString = stats.virtualBalance > 0
        ? `\n\n💳 <b>VIRTUAL:</b> ₦${stats.virtualBalance.toLocaleString()} | <b>Live:</b> ₦${(stats.liveAccountBalance || 0).toLocaleString()}`
        : `\n\n💳 <b>LIVE BALANCE:</b> Syncing...`;

    const parseGameKey = (input) => {
        if (!input) return null;
        const k = input.toLowerCase();
        if (['u4', 'bz', 'betzero'].includes(k)) return 'u4';
        if (['color', 'rb', 'rainbow'].includes(k)) return 'color';
        if (['sum', 'hl', 'hilo'].includes(k)) return 'sum';
        if (['tc', 'tc3', 'totalcolor'].includes(k)) return 'totalColor';
        if (['tc2', 'totalcolor2'].includes(k)) return 'totalColor2';
        return null;
    };

    if (cmd === '/plan') {
        sendTelegramPlanMenu(chatId).catch(() => {});
    }
    else if (cmd === '/help' || cmd === '/start') {
        const helpText = [
            `🎮 <b>AUTOMATION TELEGRAM COMMANDS</b>`,
            `<code>------------------------------------</code>`,
            `<b>Core Controls:</b>`,
            `• <code>/status</code> or <code>/config</code> — View current active settings & stats`,
            `• <code>/pause</code> or <code>/stop</code> — Pause automation execution`,
            `• <code>/resume</code> — Resume automation execution`,
            `• <code>/reset</code> — Reset Martingale steps & session trackers`,
            `• <code>/resetmaxloss</code> — Start a fresh max-loss tracking period across all markets`,
            `• <code>/plan</code> — Build a standalone martingale sequence and risk plan`,
            ``,
            `<b>Configuration Commands:</b>`,
            `• <code>/stake &lt;game&gt; &lt;amount&gt;</code> — Set base stake (e.g. <code>/stake tc 1000</code>)`,
            `• <code>/tp &lt;amount&gt;</code> — Set Take Profit target (e.g. <code>/tp 5000</code>)`,
            `• <code>/sl &lt;amount&gt;</code> — Set Stop Loss boundary (e.g. <code>/sl 10000</code>)`,
            `• <code>/unified &lt;on|off&gt;</code> — Toggle Unified Master Mode`,
            `• <code>/enable &lt;game&gt;</code> — Activate market (e.g. <code>/enable bz</code>)`,
            `• <code>/disable &lt;game&gt;</code> — Deactivate market (e.g. <code>/disable color</code>)`,
            `• <code>/rollover &lt;tc3|bzrb&gt; &lt;on|off&gt;</code> — Toggle compounding rollovers`,
            `• <code>/shadow &lt;on|off&gt;</code> — Toggle Smart Virtual Circuit Breaker`,
            `• <code>/weighted &lt;on|off&gt;</code> — Toggle ML-Weighted Base Staking`,
            `<code>------------------------------------</code>`,
            `<i>Supported game keys: bz, rb, hl, tc, tc2</i>`
        ].join('\n');
        sendPersonalDM(chatId, helpText).catch(() => {});
    }
    else if (cmd === '/status' || cmd === '/config') {
        const activeGames = Object.keys(config.enabledGames)
            .filter(g => config.enabledGames[g])
            .map(g => g.toUpperCase())
            .join(', ') || 'None';

        const statusMsg = [
            `⚙️ <b>CURRENT TELEMETRY & CONFIG</b>`,
            `<code>------------------------------------</code>`,
            `🔴 <b>Engine State:</b> ${stats.isHalted ? `PAUSED (${stats.haltReason || 'User'})` : '🟢 RUNNING'}`,
            `👑 <b>Unified Mode:</b> ${config.unifiedMode ? 'ENABLED 🟢' : 'DISABLED 🔴'}`,
            `🎯 <b>Active Markets:</b> ${activeGames}`,
            ``,
            `💰 <b>Base Stakes:</b>`,
            `  • BetZero: ₦${(config.initialStakes.u4 || 0).toLocaleString()}`,
            `  • Rainbow: ₦${(config.initialStakes.color || 0).toLocaleString()}`,
            `  • Hi/Lo: ₦${(config.initialStakes.sum || 0).toLocaleString()}`,
            `  • Total Color 3W: ₦${(config.initialStakes.totalColor || 0).toLocaleString()}`,
            `  • Total Color 2W: ₦${(config.initialStakes.totalColor2 || 0).toLocaleString()}`,
            ``,
            `🛡️ <b>Advanced Execution & Risk:</b>`,
            `  • Take Profit: ${config.takeProfit > 0 ? `+₦${config.takeProfit.toLocaleString()}` : 'Disabled'}`,
            `  • Stop Loss: ${config.stopLoss < 0 ? `-₦${Math.abs(config.stopLoss).toLocaleString()}` : 'Disabled'}`,
            `  • TC3 Rollover: ${config.tc3Rollover ? `Target Stage ${config.tc3RolloverTarget} 🟢` : 'Disabled 🔴'}`,
            `  • Shadow Mode CB: ${config.shadowMode ? 'ENABLED 🟢' : 'DISABLED 🔴'}`,
            `  • Weighted Staking: ${config.weightedStaking ? 'ENABLED 🟢' : 'DISABLED 🔴'}`,
            `<code>------------------------------------</code>`,
            `📊 <b>Session Pl:</b> ${stats.totalReturned >= 0 ? '+' : '-'}₦${Math.abs(stats.totalReturned).toLocaleString()}` + balString
        ].join('\n');

        sendPersonalDM(chatId, statusMsg).catch(() => {});
    }
    else if (cmd === '/pause' || cmd === '/stop') {
        stats.isHalted = true; 
        stats.haltReason = "🛑 Paused via Telegram";
        sendPersonalDM(chatId, `⏸ <b>Automation Paused.</b>${balString}`);
    } 
    else if (cmd === '/resume') {
        stats.isHalted = false; 
        stats.haltReason = "";
        sendPersonalDM(chatId, `▶️ <b>Automation Resumed.</b>${balString}`);
    } 
    else if (cmd === '/resetmaxloss') {
        const resetAt = resetMarketStatsTracking();
        sendPersonalDM(
            chatId,
            `📊 <b>Max-loss tracking restarted for all markets.</b>\n` +
            `Previous prediction history and current betting steps are unchanged.\n` +
            `New tracking period: ${new Date(resetAt).toLocaleString()}`
        ).catch(() => {});
    }
    else if (cmd === '/reset') {
        targetSession.martingaleState.u4 = { active: false, localStep: 1, isRollover: false, rolloverStake: 0, inShadowMode: false };
        targetSession.martingaleState.color = { active: false, localStep: 1, isRollover: false, rolloverStake: 0, inShadowMode: false };
        targetSession.martingaleState.sum = { active: false, localStep: 1, isRollover: false, rolloverStake: 0, lastStandardStake: 0, inShadowMode: false };
        targetSession.martingaleState.totalColor = { active: false, localStep: 1, isRollover: false, rolloverStake: 0, rolloverStage: 0, inShadowMode: false };
        targetSession.martingaleState.totalColor2 = { active: false, localStep: 1, inShadowMode: false };
        targetSession.masterState = { active: false, step: 1, deficit: 0, lastGamePlayed: null, lastStake: 0, inShadowMode: false };
        targetSession.balanceVerification = { pendingWinSync: false, balanceBeforeWin: 0, skippedDraw: null, refreshClicked: false };
        targetSession.lastBetDrawId = null;
        targetSession.lastBetDetails = null;
        stats.initialBalance = stats.liveAccountBalance > 0 ? stats.liveAccountBalance : null;
        stats.initialVirtualBalance = stats.liveAccountBalance > 0 ? stats.liveAccountBalance : null;
        stats.virtualBalance = stats.initialVirtualBalance || 0;
        stats.totalReturned = 0;
        stats.currentWinStreak = 0;
        stats.maxWinStreak = 0;
        stats.currentLossStreak = 0;
        stats.maxLossStreak = 0;
        sendPersonalDM(chatId, `🔄 <b>Martingale Sequence & Session Stats Reset.</b>${balString}`);
    }
    else if (cmd === '/stake') {
        const gameKey = parseGameKey(parts[1]);
        const amount = parseInt(parts[2], 10);

        if (!gameKey || isNaN(amount) || amount < 50) {
            sendPersonalDM(chatId, "⚠️ <b>Invalid Usage.</b> Example: <code>/stake tc 1000</code> (Min ₦50)").catch(() => {});
            return;
        }

        config.initialStakes[gameKey] = amount;
        sendPersonalDM(chatId, `✅ <b>Stake Updated!</b>\nTarget Market: <b>${gameKey.toUpperCase()}</b>\nNew Base Stake: <b>₦${amount.toLocaleString()}</b>${balString}`).catch(() => {});
    }
    else if (cmd === '/tp' || cmd === '/takeprofit') {
        const amount = parseInt(parts[1], 10);
        if (isNaN(amount) || amount < 0) {
            sendPersonalDM(chatId, "⚠️ <b>Invalid Usage.</b> Example: <code>/tp 5000</code> (or <code>/tp 0</code> to disable)").catch(() => {});
            return;
        }
        config.takeProfit = amount;
        sendPersonalDM(chatId, `✅ <b>Take Profit Target Updated:</b> ${amount > 0 ? `+₦${amount.toLocaleString()}` : 'Disabled'}`).catch(() => {});
    }
    else if (cmd === '/sl' || cmd === '/stoploss') {
        const amount = parseInt(parts[1], 10);
        if (isNaN(amount) || amount < 0) {
            sendPersonalDM(chatId, "⚠️ <b>Invalid Usage.</b> Example: <code>/sl 10000</code> (or <code>/sl 0</code> to disable)").catch(() => {});
            return;
        }
        config.stopLoss = amount > 0 ? -Math.abs(amount) : 0;
        sendPersonalDM(chatId, `✅ <b>Stop Loss Boundary Updated:</b> ${config.stopLoss < 0 ? `-₦${Math.abs(config.stopLoss).toLocaleString()}` : 'Disabled'}`).catch(() => {});
    }
    else if (cmd === '/unified') {
        const toggle = parts[1] ? parts[1].toLowerCase() : null;
        if (toggle === 'on') {
            config.unifiedMode = true;
            sendPersonalDM(chatId, "✅ <b>Unified Master Mode ENABLED.</b> Bot will dynamically select highest ML confidence target.").catch(() => {});
        } else if (toggle === 'off') {
            config.unifiedMode = false;
            sendPersonalDM(chatId, "✅ <b>Unified Master Mode DISABLED.</b> Bot returned to independent multi-market mode.").catch(() => {});
        } else {
            sendPersonalDM(chatId, "⚠️ <b>Invalid Usage.</b> Example: <code>/unified on</code> or <code>/unified off</code>").catch(() => {});
        }
    }
    else if (cmd === '/enable' || cmd === '/disable') {
        const gameKey = parseGameKey(parts[1]);
        if (!gameKey) {
            sendPersonalDM(chatId, `⚠️ <b>Invalid Game.</b> Use one of: <code>bz, rb, hl, tc, tc2</code>`).catch(() => {});
            return;
        }
        const enable = (cmd === '/enable');
        config.enabledGames[gameKey] = enable;
        sendPersonalDM(chatId, `✅ Market <b>${gameKey.toUpperCase()}</b> is now <b>${enable ? 'ENABLED 🟢' : 'DISABLED 🔴'}</b>`).catch(() => {});
    }
    else if (cmd === '/rollover') {
        const type = parts[1] ? parts[1].toLowerCase() : '';
        const state = parts[2] ? parts[2].toLowerCase() : '';

        if (type === 'tc3') {
            config.tc3Rollover = (state === 'on');
            sendPersonalDM(chatId, `✅ <b>TC3 Full Compounding Rollover:</b> ${config.tc3Rollover ? 'ENABLED 🟢' : 'DISABLED 🔴'}`).catch(() => {});
        } else if (type === 'bzrb') {
            config.bzRbRollover = (state === 'on');
            sendPersonalDM(chatId, `✅ <b>BetZero / Rainbow Rollover:</b> ${config.bzRbRollover ? 'ENABLED 🟢' : 'DISABLED 🔴'}`).catch(() => {});
        } else {
            sendPersonalDM(chatId, "⚠️ <b>Invalid Usage.</b> Example: <code>/rollover tc3 on</code> or <code>/rollover bzrb off</code>").catch(() => {});
        }
    }
    else if (cmd === '/shadow') {
        const toggle = parts[1] ? parts[1].toLowerCase() : null;
        if (toggle === 'on') {
            config.shadowMode = true;
            sendPersonalDM(chatId, "✅ <b>Shadow Mode CB ENABLED.</b> Circuit Breaker will now track virtual wins instead of fixed draw counts to resume execution.").catch(() => {});
        } else if (toggle === 'off') {
            config.shadowMode = false;
            sendPersonalDM(chatId, "✅ <b>Shadow Mode CB DISABLED.</b> Reverted to standard fixed-draw cooldown logic.").catch(() => {});
        } else {
            sendPersonalDM(chatId, "⚠️ <b>Invalid Usage.</b> Example: <code>/shadow on</code> or <code>/shadow off</code>").catch(() => {});
        }
    }
    else if (cmd === '/weighted') {
        const toggle = parts[1] ? parts[1].toLowerCase() : null;
        if (toggle === 'on') {
            config.weightedStaking = true;
            sendPersonalDM(chatId, "✅ <b>Weighted Base Staking ENABLED.</b> Base stakes will multiply by 1.5x on ≥65% ML confidence and 2.0x on ≥80% confidence (Step 1 only).").catch(() => {});
        } else if (toggle === 'off') {
            config.weightedStaking = false;
            sendPersonalDM(chatId, "✅ <b>Weighted Base Staking DISABLED.</b> Base stakes are strictly flat.").catch(() => {});
        } else {
            sendPersonalDM(chatId, "⚠️ <b>Invalid Usage.</b> Example: <code>/weighted on</code> or <code>/weighted off</code>").catch(() => {});
        }
    }
}

if (SITE_PUBLIC_MODE) {
    console.log('[PredictionFeed] Public API ready; waiting for authenticated worker snapshots.');
} else {
    refreshRetrainingModelArtifactFromLog();
    pollTelegramCommands();
    ensureStreaksFile(); ensureWinStepsFile(); ensureMLStreaksFile();
    setInterval(() => tick().catch((err) => {
        console.error('[ERROR] Tick failed:', err.message || err);
    }), POLL_SEC * 1000);
    tick();
    if (PREDICTION_INGEST_URL) {
        console.log('[PredictionFeed] Publishing sanitized prediction updates to the configured HTTPS API.');
        setInterval(() => publishPredictionSnapshot().catch(() => {}), POLL_SEC * 1000);
        publishPredictionSnapshot().catch(() => {});
    }
}
