// Preview only: no background settings changes and no execution/reset requests.
let appliedHistoryPreset = null;
let historyPresetPreview = null;
const PRESET_META = {
    betzero: ['BetZero', 'u4', 1.65, 1], bet49: ['Bet49', 'bet49', 7.8, 6],
    rainbow: ['Rainbow', 'color', 1.5, 1], hilo: ['High/Low', 'sum', 2, 1],
    totalColor: ['Total Color 3-way', 'totalColor', 3.8, 3],
    totalColor2: ['Total Color 2-way', 'totalColor2', 3.8, 2],
    totalColor1: ['Winning Color', 'totalColor1', 3.8, 1]
};
const presetRate = stats => stats.settled ? stats.wins / stats.settled : 0;
const presetValue = id => document.getElementById(id)?.value;
function presetInputs() {
    return JSON.stringify(['auto-capital', 'preset-game-select', 'preset-profile-select',
        'base-stake-percent', 'backtest-draws', 'preset-risk-percent', 'stop-loss'].map(presetValue));
}
async function fetchPresetHistory() {
    const response = await extensionFetch(`${SERVER_URL}/stats?clientId=${CLIENT_ID}&presetHistory=1&draws=${encodeURIComponent(presetValue('backtest-draws'))}`);
    const data = await response.json();
    if (!response.ok || !data.markets) throw new Error(data.error || 'Update the VPS bot to enable history presets.');
    return data;
}
function summaryChoice(stats) {
    const candidates = ['ENTER', 'HOLD'].filter(label => stats[label].settled >= 30
        && presetRate(stats[label]) >= presetRate(stats) + 0.05
        && stats[label].worstLosses <= stats.worstLosses);
    return candidates.sort((a, b) => presetRate(stats[b]) - presetRate(stats[a]))[0] || 'OFF';
}
function historySequenceCost(game, base, steps, profile, unified) {
    const [, key, odds, factor] = PRESET_META[game];
    let cost = 0;
    for (let step = 1; step <= steps; step++) {
        let stake;
        if (unified) {
            // Bound each next master bet using the most expensive eligible source.
            stake = Math.max(...['betzero', 'rainbow', 'hilo', 'totalColor'].map(source => {
                const [, , sourceOdds, sourceFactor] = PRESET_META[source];
                const unit = step === 1 || profile === 'flat' ? base
                    : source === 'totalColor' ? cost / 0.8 : (cost + base * (sourceOdds - 1)) / (sourceOdds - 1);
                return Math.round(unit) * sourceFactor;
            }));
            cost += stake;
            continue;
        }
        if (game === 'totalColor1') stake = TC1Staking.nextStake(base, cost, step - 1, profile === 'winning_accumulating' ? 'accumulating' : 'fixed');
        else if (profile === 'flat') stake = base;
        else if (game === 'bet49') stake = Math.ceil((cost + base * (odds - factor)) / (odds - factor));
        else stake = calculateStakeForStep(key, base, step, odds, 2);
        if (!Number.isFinite(stake) || stake <= 0) return Infinity;
        cost += stake * factor;
    }
    // Reserve extra room for explicitly selected weighted/rollover profiles.
    return cost * (['highroller_scale', 'tc3_aggressive'].includes(profile) ? 2 : 1);
}
async function previewHistoricalPreset() {
    const button = document.getElementById('btn-apply-preset');
    const apply = document.getElementById('btn-confirm-history-preset');
    const preview = document.getElementById('preset-preview');
    apply.disabled = true; historyPresetPreview = null;
    preview.style.display = 'none'; preview.replaceChildren();
    document.getElementById('setup-feedback').style.display = 'none';
    document.getElementById('preset-review-save').hidden = true;
    presetStatus('Reading your completed draw results...');
    button.disabled = true; button.textContent = 'Reading history...';
    const inputs = presetInputs();
    try {
        const capital = Number(presetValue('auto-capital'));
        const percent = Number(presetValue('base-stake-percent'));
        const riskPercent = Number(presetValue('preset-risk-percent'));
        if (!Number.isFinite(capital) || capital < 1000 || !Number.isFinite(percent) || percent < 0.01 || percent > 100
            || !Number.isFinite(riskPercent) || riskPercent < 1 || riskPercent > 100) throw new Error('Enter capital of at least 1,000 and valid stake/risk percentages.');
        const target = presetValue('preset-game-select'), profile = presetValue('preset-profile-select');
        const unified = target === 'unified' || ['unified_sniper', 'antivol_ghost', 'highroller_scale'].includes(profile);
        if (unified && !['unified', 'all', 'betzero', 'rainbow', 'hilo', 'totalColor'].includes(target)) throw new Error('Unified supports BetZero, Rainbow, High/Low and Total Color 3-way only. Select an individual profile for this game.');
        if (profile === 'winning_accumulating' && target !== 'totalColor1') throw new Error('Choose Winning Color for accumulating recovery.');
        if (profile === 'tc3_aggressive' && target !== 'totalColor') throw new Error('TC3 rollover requires Total Color 3-way.');
        if (profile === 'flat' && target === 'totalColor1') throw new Error('Winning Color has its own recovery modes; choose History recovery or Winning Color accumulating.');
        const history = await fetchPresetHistory();
        if (inputs !== presetInputs()) throw new Error('Inputs changed. Preview again.');
        let games = unified ? ['betzero', 'rainbow', 'hilo', 'totalColor'] : target === 'all' ? [...GAMES] : [target];
        const excluded = games.filter(game => history.markets[game].settled < history.minimumSamples || (profile === 'flat' && game === 'totalColor1'));
        if (unified && (excluded.length || history.markets.unified.settled < history.minimumSamples)) throw new Error('Not enough history: Unified and each of its four source games need 50 settled picks.');
        games = games.filter(game => !excluded.includes(game));
        if (!games.length) throw new Error('Not enough history. Each game needs 50 settled WIN/LOSS results after the latest reset.');
        const existingStop = Math.abs(Number(presetValue('stop-loss')) || 0);
        const budget = Math.min(capital * riskPercent / 100, existingStop || Infinity);
        const perGameBudget = unified ? budget : budget / games.length;
        const plans = {};
        for (const game of games) {
            const stats = history.markets[unified ? 'unified' : game];
            const steps = Math.min(20, Math.max(2, stats.worstLosses + 1));
            const desired = Math.min(50000, Math.max(50, Math.floor(capital * percent / 100 / games.length / 50) * 50));
            let base = desired;
            while (base >= 50 && historySequenceCost(game, base, steps, profile, unified) > perGameBudget) base -= 50;
            if (base < 50) throw new Error(`${PRESET_META[game][0]}: budget cannot cover ${steps} planned steps at the minimum stake. Increase the budget or choose fewer games / flat stakes.`);
            const gate = summaryChoice(history.markets[game]);
            const sniper = profile !== 'flat';
            plans[game] = { base, steps, gate, sniper, sniperStep: Math.min(10, Math.max(1, Math.ceil(stats.worstLosses / 2))),
                resetLosses: Math.min(5, Math.max(1, Math.ceil(stats.worstLosses / 3))) };
        }
        renderHistoryPreset({ history, plans, profile, unified, budget, excluded });
        presetStatus(history.busy
            ? 'Preview ready. Finish the active betting or recovery sequence before applying. Your progression is preserved.'
            : 'Preview ready. Review the cards below, then apply to the form.', history.busy ? 'error' : 'success');
        historyPresetPreview = { inputs, history, plans, profile, unified, budget };
        apply.disabled = history.busy;
    } catch (error) { presetStatus(error.message, 'error'); }
    finally { button.disabled = false; button.textContent = 'Preview suggested settings'; }
}

document.getElementById('btn-confirm-history-preset').addEventListener('click', async () => {
    const preview = historyPresetPreview;
    const feedback = document.getElementById('setup-feedback');
    feedback.style.display = 'block';
    feedback.dataset.tone = '';
    feedback.textContent = 'Checking that this preview can still be applied...';
    const applyButton = document.getElementById('btn-confirm-history-preset');
    applyButton.disabled = true;
    try {
        if (!preview || preview.inputs !== presetInputs()) throw new Error('Settings changed. Preview again first.');
        const current = await fetchPresetHistory();
        if (preview.inputs !== presetInputs()) throw new Error('Inputs changed while fetching history. Preview again.');
        if (current.busy) throw new Error('Finish the active execution/recovery sequence first. Nothing changed.');
        if (current.resetAt !== preview.history.resetAt || Date.now() - preview.history.generatedAt > 600000) throw new Error('History reset or preview expired. Preview again.');
        const toggle = (id, checked) => { const el = document.getElementById(id) || document.getElementById(id + '-toggle'); if (el) el.checked = checked; };
        for (const game of GAMES) {
            const plan = preview.plans[game];
            document.getElementById(`btn-${game}`).classList.toggle('active', !!plan);
            document.getElementById(`stake-${game}`).value = plan?.base || 0;
            document.getElementById(`step-${game}`).value = plan?.steps || 1;
        }
        for (const market of SNIPER_MARKETS) {
            const plan = preview.unified ? market === 'unified' ? Object.values(preview.plans)[0] : null : preview.plans[market];
            toggle(`sniper-enabled-${market}`, !!plan?.sniper);
            document.getElementById(`sniper-step-${market}`).value = plan?.sniperStep || 1;
            document.getElementById(`sniper-losses-${market}`).value = plan?.resetLosses || 1;
        }
        for (const { id } of SUMMARY_MODEL_MARKETS) document.getElementById(`summary-model-${id}`).value = preview.plans[id]?.gate || 'OFF';
        toggle('unified-mode', preview.unified);
        toggle('flat-betting', preview.profile === 'flat');
        toggle('shadowMode', preview.profile === 'antivol_ghost');
        toggle('weightedStaking', preview.profile === 'highroller_scale');
        toggle('bzrb-rollover', false);
        toggle('tc3-rollover', preview.profile === 'tc3_aggressive');
        document.getElementById('tc3-rollover-target').value = 2;
        document.getElementById('hilo-multiplier').value = '2.00';
        document.getElementById('tc1-profit-mode').value = preview.profile === 'winning_accumulating' ? 'accumulating' : 'fixed';
        document.getElementById('stop-loss').value = Math.floor(preview.budget);
        document.getElementById('cb-max-losses').value = preview.profile === 'antivol_ghost' ? Math.max(...Object.values(preview.plans).map(p => p.resetLosses)) : 0;
        appliedHistoryPreset = { generatedAt: preview.history.generatedAt, resetAt: preview.history.resetAt };
        feedback.dataset.tone = 'success';
        feedback.textContent = 'Applied to the form. Next: review your settings below and press Save Settings. Your changes have not been saved yet. Martingale amounts and progression are unchanged.';
        document.getElementById('preset-review-save').hidden = false;
    } catch (error) { feedback.dataset.tone = 'error'; feedback.textContent = error.message; }
    finally { applyButton.disabled = !historyPresetPreview || historyPresetPreview.inputs !== presetInputs() || historyPresetPreview.history.busy; }
});


function presetStatus(message, tone = '') {
    const status = document.getElementById('preset-status');
    status.hidden = false;
    status.dataset.tone = tone;
    status.textContent = message;
}
function presetNode(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
}
function presetFacts(rows) {
    const list = presetNode('dl', undefined, 'preset-facts');
    for (const [label, value] of rows) {
        const row = presetNode('div');
        row.append(presetNode('dt', label), presetNode('dd', value));
        list.append(row);
    }
    return list;
}
function renderHistoryPreset({ history, plans, profile, unified, budget, excluded }) {
    const root = document.getElementById('preset-preview');
    root.replaceChildren(); root.style.display = 'block';
    const money = value => '\u20a6' + Math.floor(value).toLocaleString();
    const overview = presetNode('section', undefined, 'preset-card');
    overview.append(presetNode('h3', 'Your preview'), presetFacts([
        ['Draws reviewed', history.draws], ['Gaps in history', history.gaps],
        ['Total risk budget', money(budget)], ['Mode', unified ? 'Unified' : 'Individual games']
    ]));
    root.append(overview);
    for (const [game, plan] of Object.entries(plans)) {
        const stats = history.markets[game];
        const supportsSummary = SUMMARY_MODEL_MARKETS.some(market => market.id === game);
        const card = presetNode('section', undefined, 'preset-card');
        card.append(presetNode('h3', PRESET_META[game][0]), presetFacts([
            ['Starting stake', money(plan.base) + (game === 'bet49' ? ' / number' : PRESET_META[game][3] > 1 ? ' / color' : '')],
            ['Maximum steps', plan.steps], ['Wins / losses', `${stats.wins} / ${stats.losses}`],
            ['Win rate', `${(presetRate(stats) * 100).toFixed(1)}%`],
            ['Worst losing streak', `${stats.worstLosses} losses`],
            ['Summary entry', supportsSummary ? plan.gate === 'OFF' ? 'Any summary' : plan.gate + ' only' : 'Not supported'],
            [unified ? 'Shared sniper entry' : 'Sniper entry', plan.sniper ? 'Step ' + plan.sniperStep : 'Off'],
            ['Pause after losses', plan.sniper ? plan.resetLosses + ' in a row' : 'Not used']
        ]));
        if (unified) card.append(presetNode('p', 'Step limits and sniper settings use the shared Unified history.', 'preset-help'));
        root.append(card);
    }
    if (excluded.length) root.append(presetNode('p', 'Not included: ' + excluded.map(game => PRESET_META[game][0]).join(', ') + '. These games need more history or do not support this play style.', 'preset-message'));
    const details = presetNode('details');
    details.append(presetNode('summary', 'Expert settings & how to read this'), presetFacts([
        ['Confidence entry filter', unified ? 'Unified selection' : 'Not used'], ['High/Low multiplier', '2x'], ['Take-profit', 'Unchanged'],
        ['Shadow mode', profile === 'antivol_ghost' ? 'On' : 'Off'],
        ['Weighted stakes', profile === 'highroller_scale' ? 'On' : 'Off'],
        ['3-way color rollover', profile === 'tc3_aggressive' ? 'On / 2 stages' : 'Off']
    ]));
    for (const message of [
        'Summary entry means the extension only enters when that summary label is active. A gate needs at least 30 labelled results and a win rate 5 percentage points above the game overall.',
        'Sniper waits for the chosen global step. After the listed losses it pauses for another entry, preserving recovery progression.',
        'Skipped picks do not count as wins or losses. History gaps break a loss run.',
        'These are suggestions from past results, not proven optimal settings. Sniper entry points have not been replay-tested. The budget estimates a losing sequence, not every rollover path; stop-loss remains enforced.'
    ]) details.append(presetNode('p', message, 'preset-help'));
    root.append(details);
}
const presetDescriptions = {
    conservative: 'Recovery stakes with history-based step limits, sniper settings and eligible summary gates.',
    flat: 'Keep stakes flat. Sniper is off; eligible summary gates can still apply. Winning Color is excluded.',
    summary: 'Recovery stakes with history-based sniper settings and eligible ENTER or HOLD gates.',
    winning_accumulating: 'Winning Color recovery with an accumulating profit target.',
    unified_sniper: 'Use the four Unified source games with a shared sniper entry and recovery sequence.',
    tc3_aggressive: 'Total Color 3-way with two-stage rollover and history-based entry settings.',
    antivol_ghost: 'Unified with shadow mode and a history-based circuit-breaker loss limit.',
    highroller_scale: 'Unified with weighted stakes and a larger reserve in the budget estimate.'
};
function describePreset() {
    document.getElementById('preset-profile-help').textContent = presetDescriptions[presetValue('preset-profile-select')] || '';
}
describePreset();
for (const id of ['auto-capital', 'preset-game-select', 'preset-profile-select', 'base-stake-percent', 'backtest-draws', 'preset-risk-percent', 'stop-loss']) {
    document.getElementById(id).addEventListener('input', () => {
        describePreset();
        if (historyPresetPreview && historyPresetPreview.inputs !== presetInputs()) {
            historyPresetPreview = null;
            document.getElementById('btn-confirm-history-preset').disabled = true;
            document.getElementById('preset-preview').style.display = 'none';
            presetStatus('Your inputs changed. Preview again to see updated suggestions.');
        }
    });
}
document.getElementById('preset-review-save').addEventListener('click', () => {
    const save = document.getElementById('save-btn');
    save.scrollIntoView({ block: 'center', behavior: 'smooth' });
    save.focus({ preventScroll: true });
});
