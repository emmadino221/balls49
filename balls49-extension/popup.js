const GAMES = ['betzero', 'rainbow', 'totalColor', 'totalColor2', 'hilo'];
const SNIPER_MARKETS = ['betzero', 'rainbow', 'hilo', 'totalColor', 'totalColor2', 'unified'];
const SUMMARY_MODEL_MARKETS = [
    { id: 'betzero', key: 'u4' },
    { id: 'rainbow', key: 'color' },
    { id: 'hilo', key: 'sum' },
    { id: 'totalColor', key: 'totalColor' }
];
let CLIENT_ID = ""; 
let LICENSE_KEY = ""; 
const SERVER_URL = "http://localhost:3001"; 

async function initializePopup() {
    CLIENT_ID = await new Promise((resolve) => {
        chrome.storage.local.get(['balls49_clientId'], (result) => {
            if (result.balls49_clientId) { resolve(result.balls49_clientId); } 
            else {
                const newId = 'user_' + Math.random().toString(36).substring(2, 11);
                chrome.storage.local.set({ balls49_clientId: newId }, () => resolve(newId));
            }
        });
    });
    checkAuthStatus();
}

function checkAuthStatus() {
    chrome.storage.local.get(['balls49_licenseKey'], (result) => {
        if (result.balls49_licenseKey) {
            LICENSE_KEY = result.balls49_licenseKey;
            unlockDashboard(); 
        } else {
            showLoginScreen();
        }
    });
}

function showLoginScreen(errorMsg = "") {
    if (document.getElementById('main-content')) document.getElementById('main-content').style.display = 'none';
    if (document.getElementById('auth-overlay')) document.getElementById('auth-overlay').style.display = 'flex';
    if (errorMsg && document.getElementById('auth-message')) document.getElementById('auth-message').textContent = errorMsg;
}

function unlockDashboard() {
    if (document.getElementById('auth-overlay')) document.getElementById('auth-overlay').style.display = 'none';
    if (document.getElementById('main-content')) document.getElementById('main-content').style.display = 'block';
    
    loadParameters(); 
    loadStats();
    
    setInterval(() => { 
        loadStats(); 
    }, 5000);
}

document.getElementById('verify-license-btn')?.addEventListener('click', async () => {
    const keyInput = document.getElementById('license-key-input')?.value.trim();
    const msgEl = document.getElementById('auth-message');
    
    if (!keyInput) {
        if (msgEl) msgEl.textContent = "Please enter a license key.";
        return;
    }
    
    chrome.storage.local.set({ balls49_licenseKey: keyInput }, () => {
        LICENSE_KEY = keyInput;
        unlockDashboard();
        
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'UPDATE_LICENSE', key: keyInput });
            }
        });
    });
});

document.getElementById('logout-btn')?.addEventListener('click', () => {
    chrome.storage.local.remove(['balls49_licenseKey'], () => {
        LICENSE_KEY = "";
        window.location.reload(); 
    });
});

GAMES.forEach(g => {
    const btn = document.getElementById(`btn-${g}`);
    if (!btn) return;
    btn.addEventListener('click', () => { btn.classList.toggle('active'); });
});

document.getElementById('toggle-btn')?.addEventListener('click', () => {
    chrome.storage.sync.get(['running'], ({ running }) => {
        const newRunning = !running;
        chrome.storage.sync.set({ running: newRunning }, () => {
            setToggleBtn(newRunning);
            fetch(`${SERVER_URL}/config?clientId=${CLIENT_ID}&key=${LICENSE_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ running: newRunning })
            }).catch(() => {});
        });
    });
});

document.getElementById('sound-btn')?.addEventListener('click', () => {
    chrome.storage.sync.get(['soundEnabled'], ({ soundEnabled }) => {
        const newVal = !soundEnabled;
        chrome.storage.sync.set({ soundEnabled: newVal }, () => setSoundBtn(newVal));
    });
});

function calculateStakeForStep(key, base, step, odds, hiloMultiplier = 2.0) {
    if (step <= 1) return base;
    if (key === 'sum') {
        const multiplier = parseFloat(hiloMultiplier) || 2.0;
        return Math.round(base * Math.pow(multiplier, step - 1));
    }
    
    let targetProfit = base * (odds - 1);
    let totalLost = 0.0;
    let currentStake = base;
    
    for (let i = 1; i <= step; i++) {
        if (i > 1) {
            if (key === 'totalColor') currentStake = totalLost / 0.8;
            else if (key === 'totalColor2') currentStake = (totalLost + base) / 1.8;
            else currentStake = (totalLost + targetProfit) / (odds - 1);
        }
        totalLost += (key === 'totalColor' ? currentStake * 3 : key === 'totalColor2' ? currentStake * 2 : currentStake);
    }
    return Math.round(currentStake);
}

function calculateCumulativeCost(gameKey, baseStake, maxSteps, odds, hiloMultiplier = 2.0) {
    let total = 0;
    for (let step = 1; step <= maxSteps; step++) {
        let st = calculateStakeForStep(gameKey, baseStake, step, odds, hiloMultiplier);
        let cost = (gameKey === 'totalColor') ? st * 3 : (gameKey === 'totalColor2') ? st * 2 : st;
        total += cost;
    }
    return total;
}

function calculateOptimalBaseUnit(gameKey, capital, targetSteps, odds, hiloMultiplier = 2.0) {
    let optimal = 50;
    for (let test = 50; test <= capital; test += 50) {
        let cost = calculateCumulativeCost(gameKey, test, targetSteps, odds, hiloMultiplier);
        if (cost <= capital) optimal = test;
        else break;
    }
    return optimal;
}

function calculateAffordableSteps(gameKey, baseStake, maxSteps, odds, hiloMultiplier, stopLossTolerance) {
    let totalExposure = 0;
    let affordableSteps = 0;

    for (let step = 1; step <= maxSteps; step++) {
        const stake = calculateStakeForStep(gameKey, baseStake, step, odds, hiloMultiplier);
        const cost = gameKey === 'totalColor' ? stake * 3 : gameKey === 'totalColor2' ? stake * 2 : stake;
        if (totalExposure + cost > stopLossTolerance) break;
        totalExposure += cost;
        affordableSteps = step;
    }

    return Math.max(1, affordableSteps);
}

function renderPresetPreview(gameKey, baseStake, steps, odds, hiloMultiplier, rolloverEnabled, baseStakePercent, requestedBaseStake, riskCapital, stopLossTolerance, originalSteps) {
    const previewEl = document.getElementById('preset-preview');
    if (!previewEl) return;

    let totalExposure = 0;
    const sequence = [];
    for (let step = 1; step <= steps; step++) {
        const stake = calculateStakeForStep(gameKey, baseStake, step, odds, hiloMultiplier);
        const cost = gameKey === 'totalColor' ? stake * 3 : gameKey === 'totalColor2' ? stake * 2 : stake;
        sequence.push(stake.toLocaleString());
        totalExposure += cost;
    }

    const riskUsedPercent = riskCapital > 0 ? (totalExposure / riskCapital) * 100 : 0;
    const safetyMargin = Math.max(0, stopLossTolerance - totalExposure);
    const baseStakeWasCapped = requestedBaseStake !== baseStake;
    const stepsWereReduced = originalSteps !== steps;

    const hiloDetails = gameKey === 'sum'
        ? ` | Multiplier: ${parseFloat(hiloMultiplier).toFixed(2)}x | Rollover: ${rolloverEnabled ? 'ON' : 'OFF'}`
        : '';

    previewEl.innerHTML =
        `<strong style="color: var(--accent-blue);">Risk Preview</strong>` +
        `<br>Base stake: <strong>₦${baseStake.toLocaleString()}</strong> | Steps: <strong>${steps}</strong>` +
        `<br>Base target: <strong>${baseStakePercent}%</strong> of risk capital${requestedBaseStake !== baseStake ? ` <span style="color: var(--accent-red);">(capped by exposure limit)</span>` : ''}` +
        `${hiloDetails}` +
        `<br>Sequence: <strong>${sequence.join(' -> ')}</strong>` +
        `<br>Total exposure: <strong>₦${Math.round(totalExposure).toLocaleString()}</strong>`;
    previewEl.style.display = 'block';
    previewEl.insertAdjacentHTML('beforeend',
        `<br>Risk capital: <strong>â‚¦${Math.round(riskCapital).toLocaleString()}</strong> | Stop loss: <strong>â‚¦${Math.round(stopLossTolerance).toLocaleString()}</strong>` +
        `<br>Risk used: <strong>${riskUsedPercent.toFixed(2)}%</strong> | Safety margin: <strong>â‚¦${Math.round(safetyMargin).toLocaleString()}</strong>` +
        `${baseStakeWasCapped ? '<br><span style="color: var(--accent-red);">Base stake reduced to stay within the exposure limit.</span>' : ''}` +
        `${stepsWereReduced ? '<br><span style="color: var(--accent-red);">Steps reduced to stay within stop-loss tolerance.</span>' : ''}`
    );
}

document.getElementById('btn-apply-preset')?.addEventListener('click', async () => {
    await applyHistoricalPreset();
});

document.getElementById('btn-run-backtest')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-run-backtest');
    const previewEl = document.getElementById('preset-preview');
    const game = document.getElementById('preset-game-select')?.value || 'hilo';
    const profile = document.getElementById('preset-profile-select')?.value || 'conservative';
    const capital = Math.max(1000, parseFloat(document.getElementById('auto-capital')?.value) || 100000);
    const basePercent = Math.min(100, Math.max(0.01, parseFloat(document.getElementById('base-stake-percent')?.value) || 0.5));
    const drawWindow = Math.min(10000, Math.max(1, parseInt(document.getElementById('backtest-draws')?.value, 10) || 1000));
    const originalText = btn.textContent;

    btn.disabled = true;
    btn.textContent = 'Running Backtest...';
    try {
        const params = new URLSearchParams({ game, profile, capital, basePercent, draws: drawWindow });
        const response = await fetch(`${SERVER_URL}/backtest?clientId=${CLIENT_ID}&key=${LICENSE_KEY}&${params}`);
        if (!response.ok) throw new Error('Backtest request failed');
        const result = await response.json();
        const sign = result.profit >= 0 ? '+' : '-';
        const stepSummary = Object.entries(result.resultsByStep || {})
            .map(([step, data]) => `S${step}: ${data.wins}W/${data.losses}L`)
            .join(' | ') || 'No completed steps';
        const gameSummary = Object.entries(result.byGame || {})
            .filter(([, data]) => data.bets > 0)
            .map(([name, data]) => `${name}: ${data.wins}W/${data.losses}L, ${data.profit >= 0 ? '+' : '-'}N${Math.abs(data.profit).toLocaleString()}`)
            .join(' | ') || 'No bets placed';

        previewEl.innerHTML =
            `<strong style="color: var(--accent-blue);">Dry-Run Backtest</strong>` +
            `<br>Game: <strong>${result.game}</strong> | Profile: <strong>${result.profile}</strong>` +
            `<br>Base stake: <strong>N${result.baseStake.toLocaleString()}</strong> (${result.basePercent}%) | Max steps: <strong>${result.maxSteps}</strong>` +
            `<br>Draws requested: <strong>${result.requestedDraws.toLocaleString()}</strong> | Available: <strong>${result.availableDraws.toLocaleString()}</strong>` +
            `<br>Completed records tested: <strong>${result.records.toLocaleString()}</strong> | Bets: <strong>${result.bets.toLocaleString()}</strong>` +
            `<br>Wins: <strong>${result.wins.toLocaleString()}</strong> | Losses: <strong>${result.losses.toLocaleString()}</strong>` +
            `<br>Win rate: <strong>${result.winRate}%</strong> | Largest stake: <strong>N${result.largestStake.toLocaleString()}</strong>` +
            `<br>Observed worst losing streak: <strong>${result.observedWorstLosingStreak}</strong> | Configured max steps: <strong>${result.maxSteps}</strong>` +
            `<br>Simulated P/L: <strong>${sign}N${Math.abs(result.profit).toLocaleString()}</strong>` +
            `<br>Max drawdown: <strong>N${result.maxDrawdown.toLocaleString()}</strong> | Peak exposure: <strong>N${result.peakExposure.toLocaleString()}</strong>` +
            `<br>Remaining risk: <strong>N${result.remainingRisk.toLocaleString()}</strong> | Rollover wins/failures: <strong>${result.rolloverWins}/${result.rolloverFailures}</strong>` +
            `<br>Results by step: <strong>${stepSummary}</strong>` +
            `<br>Results by game: <strong>${gameSummary}</strong>` +
            `<br>Calibration win rate: <strong>${result.calibration.winRate}%</strong> | Validation win rate: <strong>${result.validation.winRate}%</strong>` +
            `<br>Status: <strong>${result.halted ? result.stopReason.toUpperCase() : 'COMPLETED HISTORY'}</strong>` +
            `${result.halted ? `<br>Stopped at step <strong>${result.stoppedAtStep}</strong> on draw <strong>${result.stoppedAtDraw}</strong>` : ''}`;
        previewEl.style.display = 'block';
    } catch (error) {
        previewEl.textContent = 'Backtest unavailable. Make sure the bot server is running.';
        previewEl.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
});

async function applyHistoricalPreset() {
    const capitalInput = parseFloat(document.getElementById('auto-capital')?.value) || 100000;
    const targetGame = document.getElementById('preset-game-select')?.value || 'betzero';
    const presetKey = document.getElementById('preset-profile-select')?.value || 'conservative';
    let hiloMultiplier = parseFloat(document.getElementById('hilo-multiplier')?.value) || 2.0;
    const baseStakePercent = Math.min(100, Math.max(0.01, parseFloat(document.getElementById('base-stake-percent')?.value) || 0.5));
    const feedbackEl = document.getElementById('setup-feedback');
    const btn = document.getElementById('btn-apply-preset');
    const origText = btn.textContent;

    if (isNaN(capitalInput) || capitalInput < 1000) {
        feedbackEl.style.display = 'block';
        feedbackEl.style.color = 'var(--accent-red)';
        feedbackEl.textContent = '⚠️ Enter valid capital (Min ₦1000)';
        return;
    }

    btn.textContent = '⏳ Querying Risk Profile...';

    const gameMeta = {
        betzero:     { histKey: 'u4',          odds: 1.65, defaultSteps: 7 },
        rainbow:     { histKey: 'color',       odds: 1.50, defaultSteps: 9 },
        hilo:        { histKey: 'sum',         odds: 2.00, defaultSteps: 8 },
        totalColor:  { histKey: 'totalColor',  odds: 3.80, defaultSteps: 6 },
        totalColor2: { histKey: 'totalColor2', odds: 3.80, defaultSteps: 12 }
    };

    const targetMeta = gameMeta[targetGame] || gameMeta.betzero;

    if (targetGame === 'hilo') {
        const recoveryProfile = presetKey === 'conservative';
        hiloMultiplier = recoveryProfile ? 1.40 : 2.00;
        document.getElementById('hilo-multiplier').value = recoveryProfile ? '1.40' : '2.00';
    }

    const clearMarkets = () => {
        ['betzero', 'rainbow', 'hilo', 'totalColor', 'totalColor2'].forEach(k => {
            document.getElementById(`stake-${k}`).value = '';
            document.getElementById(`step-${k}`).value = '';
            document.getElementById(`btn-${k}`).classList.remove('active');
        });
    };

    const setToggle = (id, state) => {
        const el = document.getElementById(id) || document.getElementById(id + '-toggle');
        if (el) el.checked = !!state;
    };

    clearMarkets();

    // Stop-loss tolerance, rather than historical loss records, controls the
    // usable step count. The upper bound prevents an unbounded calculation.
    const MAX_PRESET_STEPS = 30;
    let calculatedSteps = MAX_PRESET_STEPS;

    const requestedBaseStake = Math.max(50, Math.round((capitalInput * baseStakePercent / 100) / 50) * 50);
    const stopLossTolerance = capitalInput;
    const originalSteps = calculatedSteps;
    const affordableSteps = calculateAffordableSteps(targetMeta.histKey, requestedBaseStake, calculatedSteps, targetMeta.odds, hiloMultiplier, stopLossTolerance);
    calculatedSteps = Math.min(calculatedSteps, affordableSteps);
    const maximumSafeBaseStake = calculateOptimalBaseUnit(targetMeta.histKey, capitalInput, calculatedSteps, targetMeta.odds, hiloMultiplier);
    const baseStake = Math.min(requestedBaseStake, maximumSafeBaseStake);

    document.getElementById(`stake-${targetGame}`).value = baseStake;
    document.getElementById(`step-${targetGame}`).value = calculatedSteps;
    document.getElementById(`btn-${targetGame}`).classList.add('active');

    if (presetKey === 'conservative') {
        setToggle('unified-mode', false);
        setToggle('shadowMode', true);
        setToggle('weightedStaking', false);
        setToggle('bzrb-rollover', targetGame === 'betzero' || targetGame === 'rainbow');
        setToggle('tc3-rollover', false);
        setToggle('ml-override', false);
        setToggle('flat-betting', false);

        document.getElementById('take-profit').value = Math.floor(capitalInput * 0.10);
        document.getElementById('stop-loss').value = Math.floor(capitalInput);
        document.getElementById('cb-max-losses').value = '2';

    } else if (presetKey === 'unified_sniper') {
        setToggle('unified-mode', true);
        setToggle('shadowMode', true);
        setToggle('weightedStaking', true);
        setToggle('bzrb-rollover', false);
        setToggle('tc3-rollover', false);
        setToggle('ml-override', false);

        document.getElementById('take-profit').value = Math.floor(capitalInput * 0.15);
        document.getElementById('stop-loss').value = Math.floor(capitalInput);
        document.getElementById('cb-max-losses').value = '3';

    } else if (presetKey === 'tc3_aggressive') {
        setToggle('unified-mode', false);
        setToggle('shadowMode', true);
        setToggle('weightedStaking', false);
        setToggle('bzrb-rollover', false);
        setToggle('tc3-rollover', targetGame.startsWith('totalColor'));
        document.getElementById('tc3-rollover-target').value = '3';

        document.getElementById('take-profit').value = Math.floor(capitalInput * 0.25);
        document.getElementById('stop-loss').value = Math.floor(capitalInput);
        document.getElementById('cb-max-losses').value = '3';

    } else if (presetKey === 'antivol_ghost') {
        setToggle('unified-mode', true);
        setToggle('shadowMode', true);
        setToggle('weightedStaking', false);
        setToggle('bzrb-rollover', false);
        setToggle('tc3-rollover', false);

        document.getElementById('take-profit').value = Math.floor(capitalInput * 0.08);
        document.getElementById('stop-loss').value = Math.floor(capitalInput);
        document.getElementById('cb-max-losses').value = '2';

    } else if (presetKey === 'highroller_scale') {
        setToggle('unified-mode', true);
        setToggle('shadowMode', true);
        setToggle('weightedStaking', true);
        setToggle('bzrb-rollover', true);
        setToggle('tc3-rollover', true);
        document.getElementById('tc3-rollover-target').value = '3';

        document.getElementById('take-profit').value = Math.floor(capitalInput * 0.30);
        document.getElementById('stop-loss').value = Math.floor(capitalInput);
        document.getElementById('cb-max-losses').value = '4';
    }

    // HiLo 1.40x needs rollover to recover the shortfall after a loss.
    // HiLo 2.00x is profitable after a loss without rollover, so leave the
    // unified rollover toggle at the profile's selected value.
    if (targetGame === 'hilo') {
        const recoveryProfile = presetKey === 'conservative';
        if (recoveryProfile) setToggle('bzrb-rollover', true);
    }

    const rolloverEnabled = document.getElementById('bzrb-rollover-toggle')?.checked || false;
    renderPresetPreview(targetMeta.histKey, baseStake, calculatedSteps, targetMeta.odds, hiloMultiplier, rolloverEnabled, baseStakePercent, requestedBaseStake, capitalInput, stopLossTolerance, originalSteps);

    feedbackEl.style.display = 'block';
    feedbackEl.style.color = 'var(--accent-blue)';
    feedbackEl.textContent = `✅ Calibrated ${targetGame.toUpperCase()} with ${presetKey.toUpperCase()}`;
    btn.textContent = '✅ Calibrated!';
    setTimeout(() => { btn.textContent = origText; }, 2000);
}

document.getElementById('save-btn')?.addEventListener('click', async () => {
    if (!LICENSE_KEY) return;
    const btn = document.getElementById('save-btn');
    const originalText = btn.textContent;
    btn.textContent = '⏳ Saving...';

    const stakes = {
        betzero: parseInt(document.getElementById('stake-betzero').value) || 0,
        rainbow: parseInt(document.getElementById('stake-rainbow').value) || 0,
        totalColor: parseInt(document.getElementById('stake-totalColor').value) || 0,
        totalColor2: parseInt(document.getElementById('stake-totalColor2').value) || 0,
        hilo:    parseInt(document.getElementById('stake-hilo').value)    || 0,
    };
    
    const gameSteps = {
        betzero: parseInt(document.getElementById('step-betzero').value) || 0,
        rainbow: parseInt(document.getElementById('step-rainbow').value) || 0,
        totalColor: parseInt(document.getElementById('step-totalColor').value) || 0,
        totalColor2: parseInt(document.getElementById('step-totalColor2').value) || 0,
        hilo: parseInt(document.getElementById('step-hilo').value) || 0,
    };

    const takeProfit = parseFloat(document.getElementById('take-profit').value) || 0;
    const slInput = parseFloat(document.getElementById('stop-loss').value) || 0;
    const stopLoss = slInput !== 0 ? -Math.abs(slInput) : 0;
    
    const currentGames = {
        betzero: document.getElementById('btn-betzero').classList.contains('active'),
        rainbow: document.getElementById('btn-rainbow').classList.contains('active'),
        totalColor: document.getElementById('btn-totalColor').classList.contains('active'),
        totalColor2: document.getElementById('btn-totalColor2').classList.contains('active'),
        hilo:    document.getElementById('btn-hilo').classList.contains('active')
    };

    const getToggleValue = (id) => {
        const el = document.getElementById(id) || document.getElementById(id + '-toggle');
        return el ? el.checked : false;
    };

    const telegramChatId = (document.getElementById('telegram-chat-id')?.value || '').trim();
    const flatBetting = getToggleValue('flat-betting');
    const unifiedMode = getToggleValue('unified-mode'); 
    const bzRbRollover = getToggleValue('bzrb-rollover');
    const mlOverrideMode = getToggleValue('ml-override');
    const summaryModelMarkets = Object.fromEntries(SUMMARY_MODEL_MARKETS.map(({ id, key }) => ([
        key,
        !!document.getElementById(`summary-model-${id}`)?.checked
    ])));
    const shadowMode = getToggleValue('shadowMode');
    const weightedStaking = getToggleValue('weightedStaking');
    
    const tc3Rollover = getToggleValue('tc3-rollover');
    const tc3TargetInput = document.getElementById('tc3-rollover-target');
    const requestedTc3Target = parseInt(tc3TargetInput?.value, 10);
    const tc3RolloverTarget = Number.isNaN(requestedTc3Target)
        ? 3
        : Math.min(10, Math.max(2, requestedTc3Target));
    if (tc3TargetInput) tc3TargetInput.value = String(tc3RolloverTarget);
    const hiloMultiplier = parseFloat(document.getElementById('hilo-multiplier')?.value) || 2.0;
    const baseStakePercent = Math.min(100, Math.max(0.01, parseFloat(document.getElementById('base-stake-percent')?.value) || 0.5));
    const backtestDraws = parseInt(document.getElementById('backtest-draws')?.value, 10) || 1000;

    const sniperSettings = Object.fromEntries(SNIPER_MARKETS.map(market => ([market, {
        enabled: !!document.getElementById(`sniper-enabled-${market}`)?.checked,
        step: Math.min(10, Math.max(0, parseInt(document.getElementById(`sniper-step-${market}`)?.value, 10) || 0)),
        resetLosses: Math.min(50, Math.max(0, parseInt(document.getElementById(`sniper-losses-${market}`)?.value, 10) || 0))
    }])));
    const marketLabels = { betzero: 'BetZero', rainbow: 'Rainbow', hilo: 'High/Low', totalColor: 'Total Color 3-Way', totalColor2: 'Total Color 2-Way', unified: 'Unified' };
    const invalidSniperMarket = SNIPER_MARKETS.find(market => sniperSettings[market].enabled
        && (sniperSettings[market].step < 1 || sniperSettings[market].resetLosses < 1));
    const sniperError = document.getElementById('sniper-settings-error');
    if (invalidSniperMarket) {
        if (sniperError) {
            sniperError.textContent = `${marketLabels[invalidSniperMarket]} is enabled for Sniper Mode. Enter a target step (1–10) and reset loss count (1–50).`;
            sniperError.style.display = 'block';
        }
        btn.textContent = originalText;
        return;
    }
    if (sniperError) sniperError.style.display = 'none';
    const cbMaxLosses = parseInt(document.getElementById('cb-max-losses')?.value) || 0;

    const payload = { 
        stakes, gameSteps, takeProfit, stopLoss, enabledGames: currentGames, 
        telegramChatId, flatBetting, sniperSettings, cbMaxLosses,
        unifiedMode, bzRbRollover, hiloMultiplier, baseStakePercent, backtestDraws, tc3Rollover, tc3RolloverTarget, mlOverrideMode, summaryModelMarkets,
        shadowMode, weightedStaking 
    };

    chrome.storage.sync.set(payload, async () => {
        const feedback = document.getElementById('save-feedback');
        const setFeedback = (message, success) => {
            if (!feedback) return;
            feedback.textContent = message;
            feedback.style.color = success ? 'var(--accent-green)' : 'var(--accent-red)';
            feedback.style.display = 'block';
        };
        const storageError = chrome.runtime.lastError;
        if (storageError) {
            btn.textContent = 'Save failed';
            setFeedback(`Could not save settings in Chrome: ${storageError.message}`, false);
            setTimeout(() => { btn.textContent = originalText; }, 2500);
            return;
        }

        try {
            const response = await fetch(`${SERVER_URL}/config?clientId=${CLIENT_ID}&key=${LICENSE_KEY}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || result.ok !== true) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }
            setFeedback('Settings saved in Chrome and accepted by the bot.', true);
        } catch (error) {
            btn.textContent = 'Bot sync failed';
            const detail = error instanceof TypeError
                ? 'The bot could not be reached. Make sure it is running, then save again.'
                : `The bot rejected the settings: ${error.message}`;
            setFeedback(`Settings are saved in Chrome, but not applied by the bot. ${detail}`, false);
            setTimeout(() => { btn.textContent = originalText; }, 2500);
            return;
        }
        
        setTimeout(() => { btn.textContent = '✅ Saved'; setTimeout(() => btn.textContent = originalText, 1200); }, 400);
    });
});

function wipeOverlayOnLauncherTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        const activeLauncher = tabs.find(tab => tab && tab.url && tab.url.includes('logigames.bet9ja.com/Games/Launcher'));
        if (activeLauncher && activeLauncher.id) {
            chrome.tabs.sendMessage(activeLauncher.id, { type: 'WIPE_OVERLAY' });
            return;
        }

        chrome.tabs.query({ currentWindow: true }, function(allTabs) {
            const launcherTab = allTabs.find(tab => tab && tab.url && tab.url.includes('logigames.bet9ja.com/Games/Launcher'));
            if (launcherTab && launcherTab.id) {
                chrome.tabs.sendMessage(launcherTab.id, { type: 'WIPE_OVERLAY' });
            }
        });
    });
}

document.getElementById('reset-btn')?.addEventListener('click', async () => {
    if (!LICENSE_KEY) return;
    const btn = document.getElementById('reset-btn');
    btn.textContent = '⏳ Clearing...'; btn.disabled = true;
    try {
        const res = await fetch(`${SERVER_URL}/reset?clientId=${CLIENT_ID}&key=${LICENSE_KEY}`, { method: 'POST' });
        if (res.ok) {
            btn.textContent = '✅ Cleared';
            setTimeout(() => { btn.textContent = '🔄 Wipe Execution'; btn.disabled = false; }, 1500);
            loadStats(); 
            wipeOverlayOnLauncherTab();
        } else throw new Error();
    } catch(e) {
        btn.textContent = '❌ Error';
        setTimeout(() => { btn.textContent = '🔄 Wipe Execution'; btn.disabled = false; }, 2000);
    }
});

function loadParameters() {
    chrome.storage.sync.get([
        'enabledGames', 'stakes', 'gameSteps', 'running', 'takeProfit', 
        'stopLoss', 'soundEnabled', 'telegramChatId', 'flatBetting', 'sniperSettings', 'sniperMode',
        'sniperStep', 'sniperResetLosses', 'cbMaxLosses', 'unifiedMode', 'bzRbRollover', 'hiloMultiplier', 'baseStakePercent', 'backtestDraws',
        'tc3Rollover', 'tc3RolloverTarget', 'mlOverrideMode', 'summaryModelMarkets', 'shadowMode', 'weightedStaking'
    ], (data) => {
        let enabledGames = data.enabledGames || { betzero: false, rainbow: false, totalColor: false, totalColor2: false, hilo: false };
        const stakes = data.stakes || { betzero: '', rainbow: '', totalColor: '', totalColor2: '', hilo: '' };
        const gameSteps = data.gameSteps || { betzero: '', rainbow: '', totalColor: '', totalColor2: '', hilo: '' };
        
        GAMES.forEach(g => {
            const btn = document.getElementById(`btn-${g}`);
            if (btn) btn.classList.toggle('active', !!enabledGames[g]);
        });
        
        if (document.getElementById('stake-betzero')) document.getElementById('stake-betzero').value = stakes.betzero || '';
        if (document.getElementById('stake-rainbow')) document.getElementById('stake-rainbow').value = stakes.rainbow || '';
        if (document.getElementById('stake-totalColor')) document.getElementById('stake-totalColor').value = stakes.totalColor || '';
        if (document.getElementById('stake-totalColor2')) document.getElementById('stake-totalColor2').value = stakes.totalColor2 || '';
        if (document.getElementById('stake-hilo')) document.getElementById('stake-hilo').value    = stakes.hilo    || '';
        
        if (document.getElementById('step-betzero')) document.getElementById('step-betzero').value = gameSteps.betzero || '';
        if (document.getElementById('step-rainbow')) document.getElementById('step-rainbow').value = gameSteps.rainbow || '';
        if (document.getElementById('step-totalColor')) document.getElementById('step-totalColor').value = gameSteps.totalColor || '';
        if (document.getElementById('step-totalColor2')) document.getElementById('step-totalColor2').value = gameSteps.totalColor2 || '';
        if (document.getElementById('step-hilo')) document.getElementById('step-hilo').value = gameSteps.hilo || '';
        
        if (document.getElementById('take-profit')) document.getElementById('take-profit').value   = data.takeProfit || '';
        if (document.getElementById('stop-loss')) document.getElementById('stop-loss').value     = data.stopLoss ? Math.abs(data.stopLoss) : '';
        if (document.getElementById('telegram-chat-id')) document.getElementById('telegram-chat-id').value = data.telegramChatId || '';
        
        const setCheckState = (id, val) => {
            const el = document.getElementById(id) || document.getElementById(id + '-toggle');
            if (el) el.checked = !!val;
        };

        setCheckState('flat-betting', data.flatBetting);
        setCheckState('unified-mode', data.unifiedMode);
        setCheckState('bzrb-rollover', data.bzRbRollover);
        setCheckState('ml-override', data.mlOverrideMode);
        SUMMARY_MODEL_MARKETS.forEach(({ id, key }) => {
            setCheckState(`summary-model-${id}`, data.summaryModelMarkets?.[key]);
        });
        setCheckState('shadowMode', data.shadowMode);
        setCheckState('weightedStaking', data.weightedStaking);
        setCheckState('tc3-rollover', data.tc3Rollover);
        if (document.getElementById('hilo-multiplier')) document.getElementById('hilo-multiplier').value = data.hiloMultiplier || '2.00';
        if (document.getElementById('base-stake-percent')) document.getElementById('base-stake-percent').value = data.baseStakePercent || '0.5';
        if (document.getElementById('backtest-draws')) document.getElementById('backtest-draws').value = data.backtestDraws || '1000';
        
        const tc3TargetInput = document.getElementById('tc3-rollover-target');
        if (tc3TargetInput) {
            const savedTarget = parseInt(data.tc3RolloverTarget, 10);
            tc3TargetInput.value = String(Number.isNaN(savedTarget) ? 3 : Math.min(10, Math.max(2, savedTarget)));
        }
        SNIPER_MARKETS.forEach(market => {
            const saved = data.sniperSettings?.[market];
            const legacy = { enabled: !!data.sniperMode, step: data.sniperStep || '', resetLosses: data.sniperResetLosses || '' };
            const settings = saved || legacy;
            const enabled = document.getElementById(`sniper-enabled-${market}`);
            const targetStep = document.getElementById(`sniper-step-${market}`);
            const resetLosses = document.getElementById(`sniper-losses-${market}`);
            if (enabled) enabled.checked = !!settings.enabled;
            if (targetStep) targetStep.value = settings.step || '';
            if (resetLosses) resetLosses.value = settings.resetLosses || '';
        });
        if (document.getElementById('cb-max-losses')) document.getElementById('cb-max-losses').value = data.cbMaxLosses || '';

        setToggleBtn(!!data.running);
        setSoundBtn(!!data.soundEnabled);
    });
}

function setToggleBtn(isRunning) {
    const btn = document.getElementById('toggle-btn');
    const badge = document.getElementById('header-status');
    if (!btn || !badge) return;
    if (isRunning) { 
        btn.textContent = '⏹ Stop Automation'; btn.className = 'master-btn';
        badge.textContent = '🟢 Engine Active'; badge.className = 'status-badge';
    } else { 
        btn.textContent = '▶ Start Automation'; btn.className = 'master-btn stopped';
        badge.textContent = '🔴 Engine Inactive'; badge.className = 'status-badge stopped';
    }
}

function setSoundBtn(enabled) {
    const btn = document.getElementById('sound-btn');
    if (!btn) return;
    btn.textContent = enabled ? '🔊 Sound ON' : '🔇 Sound OFF';
    btn.style.borderColor = enabled ? 'var(--accent-blue)' : 'var(--border)';
    btn.style.color = enabled ? 'var(--accent-blue)' : 'var(--text-muted)';
}

async function loadStats() {
    if (!CLIENT_ID || !LICENSE_KEY) return;
    try {
        const res = await fetch(`${SERVER_URL}/stats?clientId=${CLIENT_ID}&key=${LICENSE_KEY}`);
        if (!res.ok) throw new Error();
        const s = await res.json();
        
        if (s.currentStep) {
            const bzStepEl = document.getElementById('stats-bz-step');
            const rbStepEl = document.getElementById('stats-rb-step');
            const hlStepEl = document.getElementById('stats-hl-step');
            
            if (bzStepEl) bzStepEl.textContent = s.currentStep.u4 || 0;
            if (rbStepEl) rbStepEl.textContent = s.currentStep.color || 0;
            if (hlStepEl) hlStepEl.textContent = s.currentStep.sum || 0;
        }

        if (s.mlData) {
            updateMLBox('bz', s.mlData.u4);
            updateMLBox('rb', s.mlData.color);
            updateMLBox('hl', s.mlData.sum);
        }

        const virtEl = document.getElementById('stats-virtual-balance');
        if (virtEl) {
            const v = s.virtualBalance || 0;
            virtEl.textContent = `₦${Math.round(v).toLocaleString()}`;
        }
        const liveEl = document.getElementById('stats-live-balance');
        if (liveEl) {
            const l = s.liveAccountBalance || 0;
            liveEl.textContent = `₦${Math.round(l).toLocaleString()}`;
        }
    } catch(e) {}
}

function updateMLBox(id, data) {
    if (!data) return;
    const recEl = document.getElementById(`ml-${id}-rec`);
    const scoreEl = document.getElementById(`ml-${id}-score`);
    
    if (recEl && scoreEl) {
        recEl.textContent = data.recommendation;
        recEl.className = 'ml-rec ' + (data.recommendation === 'ENTER' ? 'enter' : 'hold');
        scoreEl.textContent = `Score: ${(data.score * 100).toFixed(0)}%`;
    }
}

initializePopup();
