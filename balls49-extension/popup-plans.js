// Popup: gap playing windows and suggested strategies (the same plans as the website's
// Strategies tab). Loaded after popup.js and uses its CLIENT_ID, SERVER_URL and helpers.
const PLAN_MARKETS = [['betzero', 'BetZero'], ['bet49', 'Bet49'], ['rainbow', 'Rainbow'], ['hilo', 'High/Low'], ['totalColor', 'TC (3-Way)'], ['totalColor1', 'Winning Color']];
const GAP_POLICY = 'CONTINUOUS_GAP_WINDOWS_V2';
const naira = value => `₦${Math.round(Number(value) || 0).toLocaleString()}`;
let planControl = null;      // the bot's automation control view: controller, revision, settings, plan
let planPreview = null;      // the last preview, whose token "Save this plan" sends back

function buildPlanRows() {
    const gapRows = document.getElementById('gap-rows');
    if (gapRows && !gapRows.children.length) gapRows.innerHTML = PLAN_MARKETS.map(([id, label]) =>
        `<div class="sniper-config-row"><label class="sniper-market-toggle"><input type="checkbox" id="gap-enabled-${id}"> ${label}</label>` +
        `<input type="number" id="gap-losses-${id}" min="1" max="100" value="3" title="${label}: loss level used to measure the average gap">` +
        `<label class="check-wrap" style="margin:0" title="Automatically choose a better-supported gap for the next window"><input type="checkbox" id="gap-auto-${id}"> Auto</label></div>`).join('');
    const games = document.getElementById('strategy-games');
    if (games && !games.children.length) games.innerHTML = PLAN_MARKETS.map(([id, label]) =>
        `<label class="check-wrap"><input type="checkbox" id="strategy-game-${id}"> ${label}</label>`).join('');
}

// Gap windows for the Save Settings payload, or an error message.
function readGapEntry() {
    const out = {};
    for (const [id, label] of PLAN_MARKETS) {
        const enabled = !!document.getElementById(`gap-enabled-${id}`)?.checked;
        const losses = parseInt(document.getElementById(`gap-losses-${id}`)?.value, 10);
        if (enabled && !(Number.isInteger(losses) && losses >= 1 && losses <= 100)) return `${label} gap windows need a loss level from 1 to 100.`;
        out[id] = { enabled, losses: Number.isInteger(losses) && losses >= 1 && losses <= 100 ? losses : 3,
            autoSelect: !!document.getElementById(`gap-auto-${id}`)?.checked, policy: GAP_POLICY };
    }
    return out;
}

async function fetchControl() {
    const response = await extensionFetch(`${SERVER_URL}/stats?clientId=${CLIENT_ID}&dashboard=1`);
    if (!response.ok) throw new Error('Cannot reach the bot.');
    return (await response.json()).control;
}

function fillGapInputs(settings) {
    for (const [id] of PLAN_MARKETS) {
        const saved = settings?.gapEntry?.[id] || {};
        const set = (key, apply) => { const el = document.getElementById(`gap-${key}-${id}`); if (el) apply(el); };
        set('enabled', el => { el.checked = saved.enabled === true; });
        set('losses', el => { el.value = saved.losses ?? 3; });
        set('auto', el => { el.checked = saved.autoSelect === true; });
    }
}

function showPlanStatus() {
    const c = planControl;
    const gapStatus = document.getElementById('gap-status');
    if (gapStatus) {
        const rows = Object.entries(c?.gapEntry || {});
        gapStatus.textContent = rows.length ? rows.map(([id, st]) => {
            const label = PLAN_MARKETS.find(m => m[0] === id)?.[1] || id;
            const window = st.windowStart ? `window #${st.windowStart}–#${st.windowEnd} (${st.completedDraws ?? 0}/${st.windowLength} draws)` : 'waiting for history to size the first window';
            return `${label}: ${st.phase} · level ${st.threshold}${st.autoSelect ? ' (auto)' : ''} · ${window}`;
        }).join('\n') : 'No gap windows saved.';
        gapStatus.style.whiteSpace = 'pre-line';
    }
    const current = document.getElementById('strategy-current');
    const plan = c?.suggestionStrategy;
    if (current) {
        current.style.whiteSpace = 'pre-line';
        current.textContent = plan
            ? `Saved plan (${plan.request.autoUpdate ? 'auto updates ON' : 'auto updates OFF'}): ${plan.message}\n` +
              plan.plans.map(p => `${p.name}: ${naira(p.base)} per selection`).join(' · ') +
              (plan.capital !== null ? `\nCapital ${naira(plan.capital)} · available ${naira(plan.available)}` : '') +
              '\nPressing Save Settings replaces this plan with your manual settings.'
            : 'No suggested plan saved. Choose games and preview one below.';
    }
    // Each screen changes plans only while it is in control, like every other setting.
    const website = c?.controller === 'website', locked = !c || website || c.running || c.busy;
    for (const id of ['strategy-preview-btn', 'strategy-apply-btn']) {
        const el = document.getElementById(id); if (!el) continue;
        el.disabled = locked || (id === 'strategy-apply-btn' && !planPreview);
    }
    const error = document.getElementById('strategy-error');
    if (error && locked && c) {
        error.style.display = 'block';
        error.textContent = website ? 'The website controls this session: use its Strategies tab, or switch to extension control.'
            : c.running ? 'Stop automation to change the plan; progression is kept.'
            : 'A placed bet or recovery is still in progress; plans can be changed once it settles.';
    } else if (error && error.dataset.kind !== 'request') error.style.display = 'none';
}

function strategyInput() {
    const capitalMode = document.getElementById('strategy-stake-mode').value === 'capital';
    const amount = Number(document.getElementById('strategy-amount').value);
    return {
        games: PLAN_MARKETS.map(([id]) => id).filter(id => document.getElementById(`strategy-game-${id}`)?.checked),
        window: Number(document.getElementById('strategy-window').value),
        capitalMode, capital: capitalMode ? amount : '', base: capitalMode ? 50 : amount,
        riskLevel: capitalMode ? document.getElementById('strategy-risk').value : 'off',
        bet49ProfitMode: document.getElementById('strategy-bet49-profit').value,
        autoUpdate: document.getElementById('strategy-auto').checked,
        riskWarningOnly: document.getElementById('strategy-auto').checked && document.getElementById('strategy-warn-only').checked
    };
}

function showStrategyError(message) {
    const error = document.getElementById('strategy-error');
    error.dataset.kind = message ? 'request' : '';
    error.textContent = message || '';
    error.style.display = message ? 'block' : 'none';
}

async function strategyCommand(action, settings) {
    const control = await fetchControl();       // the latest revision, so a stale popup cannot apply
    const response = await extensionFetch(`${SERVER_URL}/config?clientId=${CLIENT_ID}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dashboardAction: action, revision: control.revision, settings })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    return result;
}

async function previewStrategy() {
    showStrategyError(''); planPreview = null;
    const out = document.getElementById('strategy-preview');
    const input = strategyInput();
    if (!input.games.length) return showStrategyError('Select at least one game.');
    out.textContent = 'Working out the plan…';
    try {
        const { preview } = await strategyCommand('strategy-preview', input);
        planPreview = preview;
        out.style.whiteSpace = 'pre-line';
        out.textContent = `${preview.draws} draws reviewed · planned reserve ${naira(preview.reserve)}` +
            (preview.sizingBudget ? ` · risk budget ${naira(preview.sizingBudget)}` : '') + '\n' +
            preview.plans.map(p => `${p.name}: ${naira(p.base)} per selection · enters ${p.waitLosses ? `after ${p.waitLosses} losses` : 'after a win'}` +
                ` · pauses after ${p.pauseLosses} losses · up to ${p.steps} steps · reserve ${naira(p.reserve)}`).join('\n');
    } catch (error) { out.textContent = ''; showStrategyError(error.message); }
    showPlanStatus();
}

async function applyStrategy() {
    if (!planPreview) return;
    if (!confirm('Save this plan? It replaces your games, stakes and max steps with the plan. Warning-only mode, if selected, bypasses stop loss, take profit and recovery limits. Automation stays stopped; press Start separately.')) return;
    showStrategyError('');
    try {
        await strategyCommand('strategy-apply', { ...planPreview.request, token: planPreview.token });
        planPreview = null;
        document.getElementById('strategy-preview').textContent = 'Plan saved. Press Start when ready.';
        await refreshPlans(true);
        // Copy the plan's games and stakes into Chrome, so the form and the page-load sync match it.
        await chrome.storage.sync.set({ ...planControl.settings });
        loadParameters();
    } catch (error) { showStrategyError(error.message); }
}

// fillInputs: replace the gap form with the saved settings (on open and after saving a plan).
async function refreshPlans(fillInputs = false) {
    try {
        planControl = await fetchControl();
        if (fillInputs) fillGapInputs(planControl.settings);
        showPlanStatus();
    } catch (error) { /* the bot status line already reports connection problems */ }
}

function initPlans() {
    buildPlanRows();
    refreshPlans(true);
    setInterval(() => refreshPlans(false), 5000);
    const amount = document.getElementById('strategy-amount');
    document.getElementById('strategy-stake-mode')?.addEventListener('change', e => {
        amount.placeholder = e.target.value === 'capital' ? 'Capital (₦)' : 'Base per selection (₦)';
        document.getElementById('strategy-risk').disabled = e.target.value !== 'capital';
    });
    // Any change to the plan inputs needs a fresh preview before it can be saved.
    document.getElementById('strategy-section')?.addEventListener('input', e => {
        if (e.target.closest('button')) return;
        planPreview = null; showPlanStatus();
    });
    document.getElementById('strategy-preview-btn')?.addEventListener('click', previewStrategy);
    document.getElementById('strategy-apply-btn')?.addEventListener('click', applyStrategy);
    // After Save Settings the bot holds the gap windows; show its status again.
    document.getElementById('save-btn')?.addEventListener('click', () => setTimeout(() => refreshPlans(false), 1500));
}
