// Background service worker — handles Chrome notifications from content script

const API_ROUTES = new Set([
    'GET /stats', 'GET /stream', 'GET /backtest',
    'POST /config', 'POST /ack', 'POST /reset', 'POST /update-balance'
]);

async function requestBot(msg, sender) {
    const senderUrl = new URL(sender.url || 'https://invalid.example');
    const ownPopup = sender.url === chrome.runtime.getURL('popup.html');
    const gameTab = sender.tab && senderUrl.origin === 'https://logigames.bet9ja.com';
    if (sender.id !== chrome.runtime.id || (!ownPopup && !gameTab)
        || !API_ROUTES.has(`${msg.method} ${msg.path}`)) {
        throw new Error('Request not permitted.');
    }
    const settings = await chrome.storage.local.get([
        'balls49_connectionMode', 'balls49_licenseKey', 'balls49_clientId'
    ]);
    const remote = settings.balls49_connectionMode === 'remote';
    const key = settings.balls49_licenseKey;
    if (!key) throw new Error('Open the extension and enter your access key.');
    const base = remote ? 'https://159.65.25.30/extension' : 'http://localhost:3001';
    const query = new URLSearchParams(msg.query || '');
    query.delete('key');
    query.set('clientId', settings.balls49_clientId || '');
    const response = await fetch(`${base}${msg.path}?${query}`, {
        method: msg.method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: msg.method === 'POST' ? msg.body : undefined,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(15000)
    });
    return { status: response.status, body: await response.text() };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'BALLS49_API') {
        requestBot(msg, sender).then(sendResponse).catch(() => {
            sendResponse({ error: 'Could not connect to the bot. Check the connection setting and access key.' });
        });
        return true;
    }
    if (msg.type !== 'NOTIFY') return;

    const icons = {
        win:      '🏆',
        loss:     '❌',
        bet:      '🎲',
        stoploss: '🛑',
    };

    chrome.notifications.create(`balls49-${Date.now()}`, {
        type:    'basic',
        iconUrl: 'icon.png',
        title:   msg.title,
        message: msg.message,
        priority: msg.result === 'win' ? 2 : 1,
    });
});
