console.log("[Balls49] Direct-Access Engine Initialized - SaaS Edition");

let SELECTED_GAME = 'hilo'; 
let IS_UNIFIED_MODE = false;
let CURRENT_STAKES = { betzero: 500, bet49: 500, rainbow: 500, hilo: 500, totalColor: 500, totalColor2: 500 };
let isBettingActive = false;
let lastExecutedDrawId = null;          
let betBalanceUnconfirmed = false;
let SOUND_ENABLED = true;
let CLIENT_ID = ""; 
let LICENSE_KEY = ""; 
const EXECUTION_CLIENT_TOKEN = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');

const SERVER_URL = "http://localhost:3001";

let lastWins = 0;
let lastLosses = 0;
let maxWinStreak = parseInt(localStorage.getItem('b49_maxWinStreak') || '0');
let maxLossStreak = parseInt(localStorage.getItem('b49_maxLossStreak') || '0');
let currentWinStreak = parseInt(localStorage.getItem('b49_currWinStreak') || '0');
let currentLossStreak = parseInt(localStorage.getItem('b49_currLossStreak') || '0');

const RUNTIME_START_KEY = 'b49_runtime_start_ms';
const OVERLAY_POS_KEY = 'b49-live-pos';
let runtimeClockInterval = null;

function resetRuntimeClock() {
    chrome.storage.local.remove(RUNTIME_START_KEY, () => {
        updateOverlayRuntime();
    });
}

function formatRuntimeSeconds(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateOverlayRuntime() {
    const runtimeEl = document.getElementById('overlayRuntime');
    if (!runtimeEl) return;

    chrome.storage.local.get(RUNTIME_START_KEY, (result) => {
        const startMs = parseInt(result[RUNTIME_START_KEY] || '0', 10);
        if (!startMs) {
            runtimeEl.innerText = '00:00:00';
            return;
        }

        const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
        runtimeEl.innerText = formatRuntimeSeconds(elapsedSeconds);
    });
}

function startRuntimeClock() {
    updateOverlayRuntime();
    if (!runtimeClockInterval) {
        runtimeClockInterval = setInterval(updateOverlayRuntime, 1000);
    }
}

function startRuntimeOnFirstBet() {
    chrome.storage.local.get(RUNTIME_START_KEY, (result) => {
        if (!result[RUNTIME_START_KEY]) {
            chrome.storage.local.set({ [RUNTIME_START_KEY]: Date.now().toString() }, () => updateOverlayRuntime());
        } else {
            updateOverlayRuntime();
        }
    });
}

const XPATHS = {
    TAB_BETZERO: "/html/body/div[1]/div/div/div/main/div[2]/div[1]/a[6]",
    TAB_RAINBOW: "/html/body/div[1]/div/div/div/main/div[2]/div[1]/a[4]",
    TAB_HILO:    "/html/body/div[1]/div/div/div/main/div[2]/div[1]/a[2]",
    CLEAR_BTN:   "/html/body/div[1]/div/div/div/main/div[2]/div[2]/div[1]/div[2]/div[2]/div[2]/div/div",
    STAKE_INPUT: "/html/body/div[1]/div/div/div/main/div[2]/div[2]/div[3]/div/div[2]/div[1]/div[1]/input",
    GRID_PREFIX: "/html/body/div[1]/div/div/div/main/div[2]/div[2]/div[1]/div[1]/div[2]/div"
};

function getTabByText(keyword) {
    const tabs = Array.from(document.querySelectorAll('a, button, .tab'));
    return tabs.find(el => (el.innerText || el.textContent || '').toLowerCase().includes(keyword.toLowerCase())) || null;
}

function getMarketButton(containerSelector, textKeyword) {
    const buttons = Array.from(document.querySelectorAll(containerSelector || 'button, div, a'));
    return buttons.find(el => (el.innerText || el.textContent || '').toLowerCase().includes(textKeyword.toLowerCase())) || null;
}

function getLiveAccountBalance() {
    try {
        const balanceEl = document.querySelector('.rs-menu__balance-value span') || 
                          document.querySelector('.rs-menu__balance-value');

        if (balanceEl) {
            const rawText = balanceEl.innerText || balanceEl.textContent;
            const cleanedNum = rawText.replace(/[^0-9.]/g, '');
            const parsedBalance = parseFloat(cleanedNum);
            
            return isNaN(parsedBalance) ? null : parsedBalance;
        }
    } catch (e) {
        console.error("[Balls49] Failed to read balance element from DOM:", e);
    }
    return null;
}

async function syncLiveBalanceWithServer() {
    if (!LICENSE_KEY || !CLIENT_ID) return;
    
    const liveBalance = getLiveAccountBalance();
    if (liveBalance !== null && liveBalance > 0) {
        try {
            await fetch(`${SERVER_URL}/update-balance?clientId=${CLIENT_ID}&key=${LICENSE_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ balance: liveBalance })
            });
        } catch (e) {}
    }
}

async function initializeClient() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['balls49_clientId', 'balls49_licenseKey'], (result) => {
            if (result.balls49_licenseKey) {
                LICENSE_KEY = result.balls49_licenseKey;
            }
            if (result.balls49_clientId) { 
                resolve(result.balls49_clientId); 
            } else {
                const newId = 'user_' + Math.random().toString(36).substr(2, 9);
                chrome.storage.local.set({ balls49_clientId: newId }, () => resolve(newId));
            }
        });
    });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function getEl(path) { return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; }
function getBallXPath(num) { let row, index; if (num <= 12) { row = 1; index = num; } else if (num <= 24) { row = 2; index = num - 12; } else if (num <= 36) { row = 3; index = num - 24; } else { row = 4; index = num - 36; } return `${XPATHS.GRID_PREFIX}/div[${row}]/div[${index}]`; }
function safeClick(element) { if (!element) return false; if (typeof element.scrollIntoView === 'function') { element.scrollIntoView({ block: 'center', inline: 'center' }); } const events = ['mousedown', 'mouseup', 'click']; for (let eventType of events) { const ev = new MouseEvent(eventType, { view: window, bubbles: true, cancelable: true, buttons: 1 }); element.dispatchEvent(ev); } return true; }

function normalizeText(el) {
    return (el && (el.innerText || el.textContent || '') || '').trim().toLowerCase();
}

function findPlaceBetButton() {
    const selectors = [
        'a.place-bet',
        'button.place-bet',
        '.place-bet',
        '[data-action="place-bet"]',
        '[data-testid="place-bet"]',
        '[aria-label="place bet"]',
        '[aria-label="Place Bet"]',
        '[aria-label="Place bet"]',
        'button[data-action="place-bet"]',
        'button[data-testid="place-bet"]',
        'button[type="submit"]',
        'a[href="#"]'
    ];
    for (const selector of selectors) {
        const btn = document.querySelector(selector);
        if (btn) return btn;
    }

    const candidates = Array.from(document.querySelectorAll('button, a, div, span, input[type="button"]'));
    const textMatch = candidates.find(el => {
        const text = normalizeText(el);
        return /place\s*bet/i.test(text)
            || /place\s*selection/i.test(text)
            || /confirm\s*bet/i.test(text)
            || /^bet$/i.test(text)
            || /confirm/i.test(text);
    });
    return textMatch || null;
}

async function placeBet() {
    const beforeBal = getLiveAccountBalance();
    const btn = findPlaceBetButton();
    if (!btn) return false;

    try {
        safeClick(btn);
        await sleep(1200);

        const afterBal = getLiveAccountBalance();
        if (beforeBal === null || afterBal === null || (beforeBal - afterBal) < 1) {
            betBalanceUnconfirmed = true;
            console.warn('[Balls49] Bet submit was clicked but the balance change was not confirmed; not retrying to avoid a duplicate.');
        }
        return true;
    } catch (e) {
        console.error('[Balls49] placeBet error:', e);
        return false;
    }
}

async function runBetZero(numbers, stake) { 
    try { 
        const tab = getTabByText('betzero') || getEl(XPATHS.TAB_BETZERO); if (tab) safeClick(tab); await sleep(300); 
        const clear = getEl(XPATHS.CLEAR_BTN); if (clear) safeClick(clear); await sleep(150); 
        for (let num of numbers) { const ballEl = getEl(getBallXPath(num)); if (ballEl) safeClick(ballEl); await sleep(100); } 
        const input = document.querySelector('input[type="number"]') || getEl(XPATHS.STAKE_INPUT); if (input) { input.value = stake; input.dispatchEvent(new Event('input', { bubbles: true })); } 
        await sleep(200); return await placeBet(); 
    } catch (e) { return false; } 
}

async function runBet49(number, stake) {
    const selectedNumber = Number(number);
    const bet49Tab = getTabByText('bet49') || getTabByText('bet 49');
    if (!bet49Tab) {
        setOverlayDecisionReason('Bet49 bet not placed: the Bet49 tab was not found.');
        return false;
    }
    if (!Number.isInteger(selectedNumber) || selectedNumber < 1 || selectedNumber > 49 || !Number.isFinite(Number(stake)) || Number(stake) <= 0) {
        setOverlayDecisionReason('Bet49 bet not placed: the selected number or stake is invalid.');
        return false;
    }

    safeClick(bet49Tab);
    await sleep(300);
    const clearSelection = () => {
        const clearButton = getEl(XPATHS.CLEAR_BTN);
        if (clearButton) safeClick(clearButton);
        return Boolean(clearButton);
    };

    if (!clearSelection()) {
        setOverlayDecisionReason('Bet49 bet not placed: the clear-selection control was not found.');
        return false;
    }
    await sleep(150);

    let betPlaced = false;
    try {
        const numberButton = getEl(getBallXPath(selectedNumber));
        if (!numberButton) {
            setOverlayDecisionReason(`Bet49 bet not placed: number ${selectedNumber} was not found.`);
            return false;
        }
        safeClick(numberButton);
        await sleep(150);

        const stakeInput = document.querySelector('input[type="number"]') || getEl(XPATHS.STAKE_INPUT);
        if (!stakeInput) {
            setOverlayDecisionReason('Bet49 bet not placed: the stake input was not found.');
            return false;
        }
        stakeInput.value = String(Math.round(Number(stake)));
        stakeInput.dispatchEvent(new Event('input', { bubbles: true }));
        stakeInput.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(200);
        betPlaced = await placeBet();
        if (!betPlaced) setOverlayDecisionReason('Bet49 bet not placed: Bet9ja did not confirm the bet.');
        return betPlaced;
    } catch (error) {
        console.error('[Balls49] runBet49 error:', error);
        setOverlayDecisionReason(`Bet49 bet not placed: ${error.message || 'execution error'}.`);
        return false;
    } finally {
        const cleared = clearSelection();
        if (!cleared) {
            console.warn('[Balls49] Bet49 selection could not be cleared: the clear control was not found.');
            if (betPlaced) setOverlayDecisionReason('Bet49 bet placed, but the clear-selection control was not found.');
        }
    }
}

function setOverlayDecisionReason(message) {
    const reason = document.getElementById('overlayDecisionReason');
    if (reason) reason.innerText = message;
}

async function runRainbow(color, stake) { 
    try { 
        const tab = getTabByText('rainbow') || getEl(XPATHS.TAB_RAINBOW); 
        if (tab) safeClick(tab); 
        await sleep(400); 

        const targetColor = color.toLowerCase().trim();
        let colorBtn = null;
        
        const possibleBtns = document.querySelectorAll(`.rainbow__ball.${targetColor}, .g-rainbow__btn.${targetColor}`);
        for (let btn of possibleBtns) {
            if ((btn.innerText || btn.textContent || '').trim() === '2+') {
                colorBtn = btn;
                break;
            }
        }

        if (!colorBtn) {
            const allRainbowBtns = Array.from(document.querySelectorAll('.rainbow__ball, [class*="rainbow"]'));
            colorBtn = allRainbowBtns.find(el => {
                const hasColor = el.classList.contains(targetColor);
                const hasText = (el.innerText || el.textContent || '').trim() === '2+';
                return hasColor && hasText;
            });
        }

        if (colorBtn) { 
            safeClick(colorBtn); 
            await sleep(250); 
        } else {
            console.warn(`[Balls49] Rainbow "2+" button for "${color}" not found in DOM.`);
            setOverlayDecisionReason(`Rainbow bet not placed: the ${color} 2+ control was not found.`);
            return false;
        }
        
        const input = document.querySelector('input[type="number"]') || getEl(XPATHS.STAKE_INPUT); 
        if (input) { 
            input.value = stake; 
            input.dispatchEvent(new Event('input', { bubbles: true })); 
            input.dispatchEvent(new Event('change', { bubbles: true }));
        } 
        
        await sleep(300); 
        const success = await placeBet(); 
        await sleep(200); 
        
        if (colorBtn) safeClick(colorBtn); 
        return success;
    } catch (e) { 
        console.error('[Balls49] runRainbow error:', e);
        setOverlayDecisionReason(`Rainbow bet not placed: ${e.message || 'execution error'}.`);
        return false; 
    } 
}

async function runHiLo(range, stake) { 
    try { 
        const tab = getTabByText('hi/lo') || getEl(XPATHS.TAB_HILO); 
        if (tab) safeClick(tab); 
        await sleep(300); 

        const targetText = range.toUpperCase() === 'HIGH' ? 'high' : 'low';
        const button = getMarketButton('.hilo-btn', targetText) || 
                       (range.toUpperCase() === 'HIGH' ? getEl("/html/body/div[1]/div/div/div/main/div[2]/div[2]/div[1]/div[1]/div[2]/div/div/div[1]/div[1]") : getEl("/html/body/div[1]/div/div/div/main/div[2]/div[2]/div[1]/div[1]/div[2]/div/div/div[3]/div[1]"));
                       
        if (button) { safeClick(button); await sleep(150); } 
        
        const input = document.querySelector('input[type="number"]') || getEl(XPATHS.STAKE_INPUT); 
        if (input) { input.value = stake; input.dispatchEvent(new Event('input', { bubbles: true })); } 
        
        await sleep(200); 
        const success = await placeBet(); 
        await sleep(200); 
        if (button) safeClick(button); 
        return success;
    } catch (e) { return false; } 
}

async function runTotalColor(topColors, stake) {
    try {
        const tabIcon = document.querySelector('.total-colour');
        if (tabIcon) { const tab = tabIcon.closest('a'); if (tab) safeClick(tab); }
        await sleep(300);

        const targets = [topColors[0].toLowerCase(), topColors[1].toLowerCase(), 'black'];
        let allSuccess = true;
        for (let colorClass of targets) {
            const btn = document.querySelector(`.g-total__btn.${colorClass}`);
            if (btn) {
                safeClick(btn); await sleep(150);
                const input = document.querySelector('input[type="number"]');
                if (input) { input.value = stake; input.dispatchEvent(new Event('input', { bubbles: true })); }
                await sleep(200);
                
                const placed = await placeBet();
                if (!placed) allSuccess = false;
                await sleep(200); 
            }
        }
        return allSuccess;
    } catch (e) { return false; }
}

async function runTotalColor2(top2Colors, stake) {
    try {
        const tabIcon = document.querySelector('.total-colour');
        if (tabIcon) { const tab = tabIcon.closest('a'); if (tab) safeClick(tab); }
        await sleep(300);

        const targets = [top2Colors[0].toLowerCase(), top2Colors[1].toLowerCase()];
        let allSuccess = true;
        for (let colorClass of targets) {
            const btn = document.querySelector(`.g-total__btn.${colorClass}`);
            if (btn) {
                safeClick(btn); await sleep(150);
                const input = document.querySelector('input[type="number"]');
                if (input) { input.value = stake; input.dispatchEvent(new Event('input', { bubbles: true })); }
                await sleep(200);
                
                const placed = await placeBet();
                if (!placed) allSuccess = false;
                await sleep(200); 
            }
        }
        return allSuccess;
    } catch (e) { return false; }
}

function injectLiveOverlay() {
    if (document.getElementById('balls49-overlay-root')) return;

    const style = document.createElement('style');
    style.innerHTML = `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap');

        #balls49-overlay-root {
            position: fixed;
            top: 20px;
            right: 20px;
            left: auto;
            z-index: 999999;
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            font-size: 12px;
            color: #f4f4f5;
            user-select: none;
        }

        .b49-panel {
            width: 310px;
            background: rgba(15, 15, 18, 0.62);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 14px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05);
            overflow: hidden;
            transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1);
            resize: both;
            min-width: 250px;
            min-height: 200px;
            transform-origin: top left;
        }

        .b49-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 14px;
            background: rgba(255, 255, 255, 0.02);
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            cursor: move;
            touch-action: none;
        }

        .b49-title {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: 700;
            font-size: 11px;
            letter-spacing: 0.8px;
            text-transform: uppercase;
            color: #e4e4e7;
        }

        .b49-logo-icon {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #10b981;
            box-shadow: 0 0 10px #10b981;
            animation: b49-pulse 2s infinite;
        }

        @keyframes b49-pulse {
            0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
            70% { box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }
            100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }

        .b49-controls { display: flex; gap: 6px; }
        
        .b49-btn-icon {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.08);
            color: #a1a1aa;
            width: 22px; height: 22px;
            border-radius: 6px;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; font-size: 11px; transition: all 0.15s;
        }
        .b49-btn-icon:hover { background: rgba(255, 255, 255, 0.15); color: #fff; }

        .b49-body { padding: 14px; display: flex; flex-direction: column; gap: 12px; }

        .b49-directive-card {
            background: linear-gradient(135deg, rgba(251, 191, 36, 0.12) 0%, rgba(20, 20, 22, 0.4) 100%);
            border: 1px solid rgba(251, 191, 36, 0.25);
            border-radius: 10px; padding: 10px 12px;
        }
        .b49-dir-label {
            font-size: 9px; font-weight: 700; color: #fbbf24;
            letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 4px;
        }
        .b49-dir-val {
            font-size: 13px; font-weight: 700; color: #ffffff;
            display: flex; align-items: center; justify-content: space-between;
        }
        .b49-badge-action {
            background: #10b981; color: #000; font-size: 9px; font-weight: 800;
            padding: 3px 8px; border-radius: 4px; letter-spacing: 0.5px;
        }

        .b49-decision-reason {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 8px;
            padding: 9px 10px;
            color: #d4d4d8;
            font-size: 10px;
            line-height: 1.45;
        }
        .b49-decision-label {
            color: #fbbf24;
            font-size: 8px;
            font-weight: 700;
            letter-spacing: .8px;
            text-transform: uppercase;
            margin-bottom: 4px;
        }

        .b49-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .b49-metric-box {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 8px; padding: 8px 10px;
        }
        .b49-metric-label {
            font-size: 9px; color: #71717a; text-transform: uppercase;
            font-weight: 600; margin-bottom: 2px;
        }
        .b49-metric-val {
            font-size: 14px; font-weight: 700; font-family: 'JetBrains Mono', monospace; color: #fafafa;
        }

        .text-green { color: #10b981 !important; }
        .text-red { color: #ef4444 !important; }

        .b49-footer {
            background: rgba(0, 0, 0, 0.2); border-top: 1px solid rgba(255, 255, 255, 0.04);
            padding: 8px 14px; font-size: 10px; color: #71717a;
            display: flex; justify-content: space-between; align-items: center;
        }

        .b49-minimized .b49-body, .b49-minimized .b49-footer { display: none; }
    `;
    document.head.appendChild(style);

    const overlayRoot = document.createElement('div');
    overlayRoot.id = 'balls49-overlay-root';
    
    // Use extension storage for the saved overlay position instead of page storage.
    // That avoids dragging the overlay back to an old coordinate on a different page context.
    const defaultPos = { top: '20px', right: '20px', left: 'auto', bottom: 'auto' };
    overlayRoot.style.top = defaultPos.top;
    overlayRoot.style.right = defaultPos.right;
    overlayRoot.style.left = defaultPos.left;
    overlayRoot.style.bottom = defaultPos.bottom;

    chrome.storage.local.get(OVERLAY_POS_KEY, (result) => {
        const raw = result?.[OVERLAY_POS_KEY];
        if (!raw) return;

        try {
            const savedPos = JSON.parse(raw);
            if (savedPos && savedPos.top && savedPos.left) {
                overlayRoot.style.top = savedPos.top;
                overlayRoot.style.left = savedPos.left;
                overlayRoot.style.right = 'auto';
                overlayRoot.style.bottom = 'auto';
            }
        } catch (e) {
            chrome.storage.local.remove(OVERLAY_POS_KEY);
        }
    });

    overlayRoot.innerHTML = `
        <div class="b49-panel" id="b49Panel">
            <div class="b49-header" id="b49Header">
                <div class="b49-title">
                    <span class="b49-logo-icon" id="b49StatusDot"></span>
                    <span>Quant Telemetry</span>
                </div>
                <div class="b49-controls">
                    <button class="b49-btn-icon" id="b49ResetRuntimeBtn" title="Reset runtime">⟳</button>
                    <button class="b49-btn-icon" id="b49ToggleBtn" title="Minimize">—</button>
                </div>
            </div>

            <div class="b49-body">
                <div class="b49-directive-card">
                    <div class="b49-dir-label" id="overlayDirectiveLabel">Current Market</div>
                    <div class="b49-dir-val">
                        <span id="overlayTarget">WAITING FOR DATA...</span>
                        <span class="b49-badge-action" id="overlayActionBadge">HOLD</span>
                    </div>
                </div>

                <div class="b49-decision-reason">
                    <div class="b49-decision-label">Decision reason</div>
                    <div id="overlayDecisionReason">Waiting for the next draw decision.</div>
                </div>

                <div class="b49-grid">
                    <div class="b49-metric-box">
                        <div class="b49-metric-label">Live Balance</div>
                        <div class="b49-metric-val text-green" id="overlayLiveBalance">₦0</div>
                    </div>
                    <div class="b49-metric-box">
                        <div class="b49-metric-label">Virtual Balance</div>
                        <div class="b49-metric-val text-green" id="overlayVirtualBalance">₦0</div>
                    </div>
                    <div class="b49-metric-box">
                        <div class="b49-metric-label">Session P/L</div>
                        <div class="b49-metric-val text-green" id="overlayNetPl">+0.00</div>
                    </div>
                    <div class="b49-metric-box">
                        <div class="b49-metric-label">Win Rate</div>
                        <div class="b49-metric-val" id="overlayWinRate">0.0%</div>
                    </div>
                    <div class="b49-metric-box">
                        <div class="b49-metric-label">Retry State</div>
                        <div class="b49-metric-val text-green" id="overlayRetryState">Idle</div>
                    </div>
                    <div class="b49-metric-box">
                        <div class="b49-metric-label">Current Step</div>
                        <div class="b49-metric-val" id="overlayCurrentStep">Step 1</div>
                    </div>
                    <div class="b49-metric-box">
                        <div class="b49-metric-label">Runtime</div>
                        <div class="b49-metric-val text-green" id="overlayRuntime">00:00:00</div>
                    </div>
                    <div class="b49-metric-box" style="grid-column: span 2;">
                        <div class="b49-metric-label">Total Trades</div>
                        <div class="b49-metric-val" id="overlayTotalTrades">0</div>
                    </div>
                </div>
            </div>

            <div class="b49-footer">
                <span id="overlayDrawId">Draw: #----</span>
                <span id="overlaySyncTime">Syncing...</span>
            </div>
        </div>
    `;
    document.body.appendChild(overlayRoot);
    startRuntimeClock();

    const panel = document.getElementById('b49Panel');
    const header = document.getElementById('b49Header');

    // --- DRAG & DROP LOGIC: pointer-friendly for mouse and touch/mobile browsers ---
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartTop = 0;
    let dragStartLeft = 0;
    let isDragging = false;

    header.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.b49-btn-icon')) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;

        e.preventDefault();
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;

        const computedTop = parseFloat(overlayRoot.style.top || '20');
        const computedLeft = parseFloat(overlayRoot.style.left || '20');
        dragStartTop = Number.isFinite(computedTop) ? computedTop : 20;
        dragStartLeft = Number.isFinite(computedLeft) ? computedLeft : 20;

        header.style.cursor = 'grabbing';
        header.setPointerCapture?.(e.pointerId);
    });

    document.addEventListener('pointermove', (e) => {
        if (!isDragging) return;

        e.preventDefault();
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;

        overlayRoot.style.right = 'auto';
        overlayRoot.style.bottom = 'auto';
        overlayRoot.style.top = `${dragStartTop + dy}px`;
        overlayRoot.style.left = `${dragStartLeft + dx}px`;
    });

    document.addEventListener('pointerup', () => {
        if (!isDragging) return;

        isDragging = false;
        header.style.cursor = 'move';

        chrome.storage.local.set({ [OVERLAY_POS_KEY]: JSON.stringify({
            top: overlayRoot.style.top,
            left: overlayRoot.style.left
        }) });

        try {
            localStorage.removeItem(OVERLAY_POS_KEY);
        } catch (e) {}
    });

    // --- FIX: TEXT RESIZE OBSERVER LOGIC ---
    // Detects when the user pulls the resize corner and automatically scales the text using CSS zoom
    const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
            const width = entry.contentRect.width;
            const scaleFactor = width / 310; // Base width is 310px
            
            // Adjust the CSS zoom property for perfectly proportional scaling
            if (panel.style.zoom !== undefined) {
                panel.style.zoom = scaleFactor;
            } else {
                panel.style.transform = `scale(${scaleFactor})`;
            }
        }
    });
    resizeObserver.observe(panel);

    const runtimeResetBtn = document.getElementById('b49ResetRuntimeBtn');
    runtimeResetBtn.addEventListener('click', () => {
        resetRuntimeClock();
        const badge = document.getElementById('overlayActionBadge');
        if (badge) {
            badge.innerText = 'RESET';
            badge.style.background = '#10b981';
            badge.style.color = '#000';
            setTimeout(() => {
                if (badge) {
                    badge.innerText = 'HOLD';
                    badge.style.background = '#10b981';
                    badge.style.color = '#000';
                }
            }, 800);
        }
    });

    const toggleBtn = document.getElementById('b49ToggleBtn');
    toggleBtn.addEventListener('click', () => {
        panel.classList.toggle('b49-minimized');
        toggleBtn.innerText = panel.classList.contains('b49-minimized') ? '+' : '—';
    });
}

function updateLiveOverlay(data) {
    if (!document.getElementById('balls49-overlay-root')) injectLiveOverlay();

    if (data && data.error) {
        const dot = document.getElementById('b49StatusDot');
        if (dot) {
            dot.style.background = '#f43f5e';
            dot.style.boxShadow = '0 0 10px #f43f5e';
        }
        const badge = document.getElementById('overlayActionBadge');
        if (badge) {
            badge.innerText = 'LOCKED';
            badge.style.background = '#f43f5e';
            badge.style.color = '#fff';
        }
        const reason = document.getElementById('overlayDecisionReason');
        if (reason) reason.innerText = data.message || data.error || 'Unable to read the current automation state.';
        return;
    }

    if (!data) return;

    const reasonEl = document.getElementById('overlayDecisionReason');
    if (reasonEl) reasonEl.innerText = data.decisionReason || 'Waiting for the next draw decision.';

    const balEl = document.getElementById('overlayLiveBalance');
    if (balEl) {
        const balVal = data.liveAccountBalance !== undefined ? data.liveAccountBalance : (getLiveAccountBalance() || 0);
        balEl.innerText = `₦${Math.round(balVal).toLocaleString()}`;
    }
    const virtEl = document.getElementById('overlayVirtualBalance');
    if (virtEl) {
        const virtVal = data.virtualBalance !== undefined ? data.virtualBalance : 0;
        virtEl.innerText = `₦${Math.round(virtVal).toLocaleString()}`;
        virtEl.className = 'b49-metric-val ' + (virtVal >= 0 ? 'text-green' : 'text-red');
    }

    if (data.wins === 0 && data.losses === 0) {
        lastWins = 0; lastLosses = 0;
        currentWinStreak = 0; currentLossStreak = 0;
        maxWinStreak = 0; maxLossStreak = 0;
    }

    if (data.wins > lastWins) {
        currentWinStreak += (data.wins - lastWins); currentLossStreak = 0;
        if (currentWinStreak > maxWinStreak) { maxWinStreak = currentWinStreak; localStorage.setItem('b49_maxWinStreak', maxWinStreak); }
        lastWins = data.wins;
    }

    if (data.losses > lastLosses) {
        currentLossStreak += (data.losses - lastLosses); currentWinStreak = 0;
        if (currentLossStreak > maxLossStreak) { maxLossStreak = currentLossStreak; localStorage.setItem('b49_maxLossStreak', maxLossStreak); }
        lastLosses = data.losses;
    }
    if (lastWins === 0 && data.wins > 0) lastWins = data.wins;
    if (lastLosses === 0 && data.losses > 0) lastLosses = data.losses;

    const isHalted = data.status && data.status.includes('Halted');
    const isCbActive = data.cbStatus && data.cbStatus.active;
    const isWarning = data.status && (data.status.includes('WAITING') || data.status.includes('CB'));

    const dot = document.getElementById('b49StatusDot');
    if (dot) {
        let color = '#10b981';
        if (isHalted) color = '#f43f5e';
        else if (isCbActive) color = '#f97316'; 
        else if (isWarning) color = '#fbbf24';
        
        dot.style.background = color;
        dot.style.boxShadow = `0 0 10px ${color}`;
    }

    const wins = data.wins || 0;
    const losses = data.losses || 0;
    const total = wins + losses;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
    const profit = data.totalReturned || data.profit || 0;
    const betsPlaced = data.betsPlaced || total;

    const targetEl = document.getElementById('overlayTarget');
    const directiveLabel = document.getElementById('overlayDirectiveLabel');
    if (directiveLabel) directiveLabel.innerText = IS_UNIFIED_MODE ? '👑 Unified Directive' : 'Current Market';
    if (targetEl) {
        let targetText = 'WAITING...';
        if (SELECTED_GAME === 'betzero') targetText = '🎯 BetZero';
        else if (SELECTED_GAME === 'bet49') targetText = '🟠 Bet49';
        else if (SELECTED_GAME === 'rainbow') targetText = '🌈 Rainbow';
        else if (SELECTED_GAME === 'totalcolor') targetText = '🎨 Total Color 3W';
        else if (SELECTED_GAME === 'totalcolor2') targetText = '🎭 Total Color 2W';
        else if (SELECTED_GAME === 'hilo') targetText = '📊 High/Low';
        targetEl.innerText = targetText;
    }

    const badge = document.getElementById('overlayActionBadge');
    if (badge) {
        if (isHalted) {
            badge.innerText = 'LOCKED';
            badge.style.background = '#f43f5e';
            badge.style.color = '#fff';
        } else if (isCbActive) {
            badge.innerText = `CB PAUSE (${data.cbStatus.remainingMin}m)`;
            badge.style.background = '#f97316';
            badge.style.color = '#fff';
        } else if (data.decisionReason && /held|skipped|waiting|no enabled|no prediction/i.test(data.decisionReason)) {
            badge.innerText = 'HOLD';
            badge.style.background = '#f59e0b';
            badge.style.color = '#000';
        } else {
            const action = (data.status && data.status.includes('Active')) ? 'ENTER' : 'HOLD';
            badge.innerText = action;
            badge.style.background = action === 'ENTER' ? '#10b981' : '#f59e0b';
            badge.style.color = '#000';
        }
    }

    const plEl = document.getElementById('overlayNetPl');
    if (plEl) {
        plEl.innerText = (profit >= 0 ? '+' : '-') + `₦${Math.abs(Math.round(profit)).toLocaleString()}`;
        plEl.className = `b49-metric-val ${profit >= 0 ? 'text-green' : 'text-red'}`;
    }

    const wrEl = document.getElementById('overlayWinRate');
    if (wrEl) wrEl.innerText = `${winRate}%`;

    const tradesEl = document.getElementById('overlayTotalTrades');
    if (tradesEl) tradesEl.innerText = betsPlaced;

    const stepEl = document.getElementById('overlayCurrentStep');
    if (stepEl && data.currentStep) {
        let currentStep = 1;
        if (SELECTED_GAME === 'betzero') currentStep = data.currentStep.u4 || 1;
        else if (SELECTED_GAME === 'bet49') currentStep = data.currentStep.bet49 || 1;
        else if (SELECTED_GAME === 'rainbow') currentStep = data.currentStep.color || 1;
        else if (SELECTED_GAME === 'totalcolor') currentStep = data.currentStep.totalColor || 1;
        else if (SELECTED_GAME === 'totalcolor2') currentStep = data.currentStep.totalColor2 || 1;
        else if (SELECTED_GAME === 'hilo') currentStep = data.currentStep.sum || 1;
        
        stepEl.innerText = `Step ${currentStep}`;
    }

    const retryEl = document.getElementById('overlayRetryState');
    if (retryEl) {
        if (isCbActive) {
            retryEl.innerText = `CB Cooling (${data.cbStatus.remainingMin}m left)`;
            retryEl.className = 'b49-metric-val text-red';
        } else if (data.retryStatus && data.retryStatus.active) {
            const remaining = Math.max(0, Math.ceil((data.retryStatus.nextRetryAt - Date.now()) / 1000));
            const attempts = Math.min(data.retryStatus.retries, 3);

            if (data.retryStatus.finalAlertSent || attempts >= 3) {
                retryEl.innerText = 'Retry limit reached';
                retryEl.className = 'b49-metric-val text-red';
            } else if (attempts === 0) {
                retryEl.innerText = `Retry queued (${remaining}s)`;
                retryEl.className = 'b49-metric-val text-red';
            } else {
                retryEl.innerText = `Retry ${attempts}/3 in ${remaining}s`;
                retryEl.className = 'b49-metric-val text-red';
            }
        } else {
            retryEl.innerText = 'Idle';
            retryEl.className = 'b49-metric-val text-green';
        }
    }

    updateOverlayRuntime();

    const syncEl = document.getElementById('overlaySyncTime');
    if (syncEl) syncEl.innerText = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function pollOverlayData() {
    if (!LICENSE_KEY) return setTimeout(pollOverlayData, 2000); 
    
    syncLiveBalanceWithServer();

    try {
        const settings = await getStorage(['enabledGames', 'unifiedMode']);
        setSelectedGameFromSettings(settings);

        const statsRes = await fetch(`${SERVER_URL}/stats?clientId=${CLIENT_ID}&key=${LICENSE_KEY}`);
        const stats = statsRes.ok ? await statsRes.json() : null;
        updateLiveOverlay(stats);
    } catch(e) {}
    setTimeout(pollOverlayData, 1500);
}

function setSelectedGameFromSettings(settings) {
    IS_UNIFIED_MODE = Boolean(settings?.unifiedMode);
    if (IS_UNIFIED_MODE || !settings?.enabledGames) return;

    const enabledGames = settings.enabledGames;
    if (enabledGames.bet49) SELECTED_GAME = 'bet49';
    else if (enabledGames.totalColor2) SELECTED_GAME = 'totalcolor2';
    else if (enabledGames.totalColor) SELECTED_GAME = 'totalcolor';
    else if (enabledGames.rainbow || enabledGames.color) SELECTED_GAME = 'rainbow';
    else if (enabledGames.hilo || enabledGames.sum) SELECTED_GAME = 'hilo';
    else if (enabledGames.betzero || enabledGames.u4) SELECTED_GAME = 'betzero';
}

function getStorage(keys) {
    return new Promise(resolve => chrome.storage.sync.get(keys, resolve));
}

function calcLocalStake(key, currentStep, userStakes, gameStepsLimits, hiloMultiplier = 2.0) {
    let gameKey = 'betzero';
    if (key === 'color') gameKey = 'rainbow';
    if (key === 'sum') gameKey = 'hilo';
    if (key === 'totalColor') gameKey = 'totalColor';
    if (key === 'totalColor2') gameKey = 'totalColor2';

    if (key === 'bet49') gameKey = 'bet49';
    const base  = userStakes[gameKey] || 500;
    const maxLimit = Number(gameStepsLimits[gameKey]) || 0;
    const requestedStep = currentStep || 1;
    const step = maxLimit > 0 ? Math.min(requestedStep, maxLimit) : requestedStep;

    if (key === 'totalColor') {
        let totalLost = 0;
        let stake = base;
        for (let i = 1; i <= step; i++) {
            if (i === 1) {
                stake = base;
            } else {
                stake = totalLost / 0.8;
            }
            totalLost += (stake * 3);
        }
        return Math.round(stake);
    }

    if (key === 'totalColor2') {
        let totalLost = 0;
        let stake = base;
        for (let i = 1; i <= step; i++) {
            if (i === 1) {
                stake = base;
            } else {
                stake = (totalLost + base) / 1.8;
            }
            totalLost += (stake * 2);
        }
        return Math.round(stake);
    }

    if (key === 'sum') {
        const MULTIPLIER = parseFloat(hiloMultiplier) || 2.0;
        let currentStake = base * Math.pow(MULTIPLIER, step - 1);
        return Math.round(currentStake);
    }

    const ODDS = { u4: 1.65, bet49: 7.80, color: 1.50 };
    const odds  = ODDS[key];
    const tgt   = base * (odds - 1);
    let lost = 0, stake = base;
    for (let i = 1; i <= step; i++) {
        stake = i === 1 ? base : (lost + tgt) / (odds - 1);
        lost += stake;
    }
    return Math.round(stake);
}

async function listen() {
    if (!LICENSE_KEY) return setTimeout(listen, 2000);

    try {
        const r = await fetch(`${SERVER_URL}/stream?clientId=${CLIENT_ID}&key=${LICENSE_KEY}&executionToken=${EXECUTION_CLIENT_TOKEN}`);
        if (r.ok) {
            const m = await r.json();
            
            if (m.error) {
                isBettingActive = false;
                setTimeout(listen, 5000);
                return;
            }

            if (m && m.action === "FORCE_RELOAD") {
                console.warn("[Balls49] Autonomous healing trigger received. Reloading page...");
                window.location.reload();
                return;
            }
            
            if (m && m.action === "REFRESH_BALANCE") {
                const refreshBtn = document.querySelector('.rs-menu__balance--refresh');
                if (refreshBtn) {
                    safeClick(refreshBtn);
                }

                fetch(`${SERVER_URL}/ack?clientId=${CLIENT_ID}&key=${LICENSE_KEY}`, { 
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: "REFRESH_BALANCE" })
                }).catch(()=>{});

                setTimeout(syncLiveBalanceWithServer, 500);
                return setTimeout(listen, 500);
            }

            if (m && m.action === "EXECUTE_BET" && !isBettingActive) {
                const storage = await getStorage(['running', 'stakes', 'gameSteps', 'hiloMultiplier']);
                if (storage.running !== true) {
                    isBettingActive = false;
                    fetch(`${SERVER_URL}/ack?clientId=${CLIENT_ID}&key=${LICENSE_KEY}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ drawId: m.drawId, status: 'CANCELLED', executionToken: m.executionToken })
                    }).catch(() => {});
                    return setTimeout(listen, 1200);
                }

                if (m.drawId && String(m.drawId) === String(lastExecutedDrawId)) {
                    fetch(`${SERVER_URL}/ack?clientId=${CLIENT_ID}&key=${LICENSE_KEY}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ drawId: m.drawId, status: 'SUCCESS', executionToken: m.executionToken })
                    }).catch(() => {});
                    return setTimeout(listen, 1200);
                }

                isBettingActive = true;

                const userStakes = storage.stakes || { betzero: 500, bet49: 500, rainbow: 500, hilo: 500, totalColor: 500, totalColor2: 500 };
                const gameStepsLimits = storage.gameSteps || { betzero: 8, bet49: 8, rainbow: 8, hilo: 8, totalColor: 8, totalColor2: 8 };
                const hiloMult   = parseFloat(storage.hiloMultiplier) || 2.0;
                const serverSteps = m.steps || { betzero: 1, bet49: 1, rainbow: 1, hilo: 1, totalColor: 1, totalColor2: 1 };

                const bzStake  = m.stake || calcLocalStake('u4', serverSteps.betzero, userStakes, gameStepsLimits, hiloMult);
                const bet49Stake = m.bet49Stake || calcLocalStake('bet49', serverSteps.bet49, userStakes, gameStepsLimits, hiloMult);
                const rbStake  = m.colorStake || calcLocalStake('color', serverSteps.rainbow, userStakes, gameStepsLimits, hiloMult);
                const serverHiLoStake = Number(m.sumStake);
                const hlStake = Number.isFinite(serverHiLoStake) && serverHiLoStake > 0
                    ? Math.round(serverHiLoStake)
                    : m.hiloRollover
                        ? 0
                        : calcLocalStake('sum', serverSteps.hilo, userStakes, gameStepsLimits, hiloMult);
                const tcStake  = m.tcStake || calcLocalStake('totalColor', serverSteps.totalColor, userStakes, gameStepsLimits, hiloMult);
                const tc2Stake = m.tc2Stake || calcLocalStake('totalColor2', serverSteps.totalColor2, userStakes, gameStepsLimits, hiloMult);

                try {
                    lastExecutedDrawId = String(m.drawId);
                    betBalanceUnconfirmed = false;
                    let playedAny = false;
                    let betSuccess = true;

                    if (m.numbers && m.stake > 0) {
                        SELECTED_GAME = 'betzero';
                        let res = await runBetZero(m.numbers, bzStake);
                        if (!res) betSuccess = false;
                        playedAny = true;
                    }
                    if (Number.isInteger(Number(m.bet49)) && Number(m.bet49) >= 1 && Number(m.bet49) <= 49 && bet49Stake > 0) {
                        SELECTED_GAME = 'bet49';
                        const res = await runBet49(m.bet49, bet49Stake);
                        if (!res) betSuccess = false;
                        playedAny = true;
                    }
                    if (m.color && m.colorStake > 0) {
                        SELECTED_GAME = 'rainbow';
                        let res = await runRainbow(m.color, rbStake);
                        if (!res) betSuccess = false;
                        playedAny = true;
                    }
                    if (m.sumRange && hlStake > 0) {
                        SELECTED_GAME = 'hilo';
                        let res = await runHiLo(m.sumRange, hlStake);
                        if (!res) betSuccess = false;
                        playedAny = true;
                    }
                    if (m.totalColor2 && m.tc2Stake > 0) {
                        SELECTED_GAME = 'totalcolor2';
                        let res = await runTotalColor2(m.totalColor2, tc2Stake);
                        if (!res) betSuccess = false;
                        playedAny = true;
                    } 
                    if (m.totalColor && m.tcStake > 0) {
                        SELECTED_GAME = 'totalcolor';
                        let res = await runTotalColor(m.totalColor, tcStake);
                        if (!res) betSuccess = false;
                        playedAny = true;
                    }
                    
                    if (playedAny && m.drawId) {
                        startRuntimeOnFirstBet();

                        setOverlayDecisionReason(betSuccess
                            ? betBalanceUnconfirmed
                                ? `Bet submitted for draw #${m.drawId}; balance change not confirmed. Verify the account manually. No retry was sent to avoid a duplicate.`
                                : `Bet placed for draw #${m.drawId}.`
                            : 'Bet was not placed: the market control reported an execution failure.');

                        const drawEl = document.getElementById('overlayDrawId');
                        if (drawEl) drawEl.innerText = `Draw: #${m.drawId}`;

                        await fetch(`${SERVER_URL}/ack?clientId=${CLIENT_ID}&key=${LICENSE_KEY}`, { 
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ 
                                drawId: m.drawId,
                                status: betSuccess ? 'SUCCESS' : 'FAILED',
                                executionToken: m.executionToken
                            })
                        });
                    }
                    if (!playedAny) {
                        setOverlayDecisionReason('Bet was not placed: no eligible market was included in the instruction.');
                        await fetch(`${SERVER_URL}/ack?clientId=${CLIENT_ID}&key=${LICENSE_KEY}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ drawId: m.drawId, status: 'FAILED', executionToken: m.executionToken })
                        });
                    }
                } catch(e) {
                    console.error("Execution Failed. Receipt not sent.");
                    setOverlayDecisionReason(`Bet was not placed: ${e.message || 'execution error'}.`);
                    fetch(`${SERVER_URL}/ack?clientId=${CLIENT_ID}&key=${LICENSE_KEY}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ drawId: m.drawId, status: 'FAILED', executionToken: m.executionToken })
                    }).catch(() => {});
                }

                isBettingActive = false;
            }
        }
    } catch (e) {
        console.error('[Balls49] Listen loop error:', e);
    }
    setTimeout(listen, 1200);
}

document.addEventListener('keydown', function(e) {
    if (e.key.toLowerCase() === 'b' && e.target && !e.target.matches('input, textarea')) {
        const overlay = document.getElementById('balls49-overlay-root');
        if (!overlay) return;
        const isHidden = overlay.style.display === 'none';
        overlay.style.display = isHidden ? 'block' : 'none';
    }
    if (e.key.toLowerCase() === 'r' && e.target && !e.target.matches('input, textarea') && LICENSE_KEY) {
        fetch(`${SERVER_URL}/reset?clientId=${CLIENT_ID}&key=${LICENSE_KEY}`, { method: 'POST' })
            .then(() => {
                const badge = document.getElementById('overlayActionBadge');
                if (badge) {
                    badge.innerText = 'RESET!';
                    setTimeout(() => { if (badge) badge.innerText = 'HOLD'; }, 1500);
                }
            });
    }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // --- FIX: WIPES DATA ON THE LIVE WEBPAGE OVERLAY WHEN TRIGGERED ---
    if (msg.type === 'WIPE_OVERLAY') {
        const elementsToClear = [
            'overlayCurrentStep', 'overlayWinRate', 'overlayTotalTrades', 
            'overlayVirtualBalance', 'overlayNetPl'
        ];
        elementsToClear.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                if (id.includes('VirtualBalance') || id.includes('NetPl')) el.innerText = '₦0';
                else if (id.includes('Rate')) el.innerText = '0.0%';
                else if (id.includes('Step')) el.innerText = 'Step 1';
                else el.innerText = '0';
            }
        });

        resetRuntimeClock();

        const badge = document.getElementById('overlayActionBadge');
        if (badge) {
            badge.innerText = 'WIPED';
            badge.style.background = '#f59e0b';
            badge.style.color = '#000';
        }
        sendResponse({ ok: true });
        return true;
    }

    if (msg.type === 'RESET_MARTINGALE') {
        if (LICENSE_KEY) {
            fetch(`${SERVER_URL}/reset?clientId=${CLIENT_ID}&key=${LICENSE_KEY}`, { method: 'POST' })
                .then(res => res.json()).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
        }
        resetRuntimeClock();
        const badge = document.getElementById('overlayActionBadge');
        if (badge) {
            badge.innerText = 'RESET!';
            setTimeout(() => { if (badge) badge.innerText = 'HOLD'; }, 1500);
        }
        return true; 
    }
    
    if (msg.type === 'FACTORY_RESET') {
        lastWins = 0; 
        lastLosses = 0; 
        currentWinStreak = 0; 
        currentLossStreak = 0; 
        maxWinStreak = 0; 
        maxLossStreak = 0;
        resetRuntimeClock();
        
        const badge = document.getElementById('overlayActionBadge');
        if (badge) {
            badge.innerText = 'WIPED';
            setTimeout(() => { if (badge) badge.innerText = 'HOLD'; }, 1500);
        }
        sendResponse({ ok: true });
        return true;
    }
    
    if (msg.type === 'UPDATE_LICENSE') {
        LICENSE_KEY = msg.key;
        injectLiveOverlay(); 
        sendResponse({ ok: true });
    }
});

async function startApp() {
    CLIENT_ID = await initializeClient();
    
    if (LICENSE_KEY) {
        chrome.storage.sync.get([
            'stakes', 'gameSteps', 'takeProfit', 'stopLoss', 
            'enabledGames', 'schedule', 'telegramChatId', 'step1Only', 
            'hiloStrategy', 'flatBetting', 'sniperMode', 'sniperStep', 'sniperResetLosses',
            'dynamicStakePercent', 'cbMaxLosses', 'cbCooldown',
            'mlOverrideMode', 'unifiedMode', 'hiloMultiplier' 
        ], (data) => {
            if (data) {
                setSelectedGameFromSettings(data);
                
                fetch(`${SERVER_URL}/config?clientId=${CLIENT_ID}&key=${LICENSE_KEY}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                }).catch(() => {});
            }
        });
    }

    injectLiveOverlay();
    pollOverlayData();
    listen();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
} else {
    startApp();
}