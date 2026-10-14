'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
    SUMMARY_MODEL_MARKETS, makeDefaultSummaryModelMarkets, normalizeSummaryModelTargets,
    getSummaryGateTarget, summaryGateAllows, getIssuedSummaryLabels, applySummaryGateConfig
} = require('./summary-gate');

const aliases = { u4: 'betzero', color: 'rainbow', sum: 'hilo', totalColor: 'totalColor' };
const config = () => ({ summaryModelMarkets: makeDefaultSummaryModelMarkets(), summaryModelTargets: normalizeSummaryModelTargets() });

test('Off, ENTER and HOLD gate behavior for each supported market', () => {
    for (const key of SUMMARY_MODEL_MARKETS) {
        const settings = config();
        for (const label of ['ENTER', 'HOLD', 'LEARNING', null, undefined]) {
            assert.equal(summaryGateAllows(settings, key, { [aliases[key]]: label }), true);
        }
        settings.summaryModelMarkets[key] = true;
        for (const target of ['ENTER', 'HOLD']) {
            settings.summaryModelTargets[key] = target;
            for (const label of ['ENTER', 'HOLD', 'LEARNING', null, undefined]) {
                assert.equal(summaryGateAllows(settings, key, { [aliases[key]]: label }), target === label);
            }
        }
    }
});

test('legacy enabled gates still mean ENTER and new gates default to Off', () => {
    const legacy = { summaryModelMarkets: { u4: true } };
    assert.equal(getSummaryGateTarget(legacy, 'u4'), 'ENTER');
    assert.equal(summaryGateAllows(legacy, 'u4', { betzero: 'HOLD' }), false);
    assert.equal(summaryGateAllows(legacy, 'u4', { betzero: 'ENTER' }), true);
    for (const key of SUMMARY_MODEL_MARKETS) assert.equal(getSummaryGateTarget(config(), key), null);
});

test('per-market choices survive serialization and validated config updates', () => {
    const settings = config();
    applySummaryGateConfig(settings, {
        summaryModelMarkets: { u4: true, color: true }, summaryModelTargets: { u4: 'HOLD', color: 'ENTER' }
    });
    const restored = JSON.parse(JSON.stringify(settings));
    restored.summaryModelTargets = normalizeSummaryModelTargets(restored.summaryModelTargets);
    assert.equal(getSummaryGateTarget(restored, 'u4'), 'HOLD');
    assert.equal(getSummaryGateTarget(restored, 'color'), 'ENTER');
    assert.equal(getSummaryGateTarget(restored, 'sum'), null);
    applySummaryGateConfig(restored, {
        summaryModelMarkets: { u4: 'false', bet49: true }, summaryModelTargets: { u4: 'ANY', color: false, bet49: 'HOLD' }
    });
    assert.equal(getSummaryGateTarget(restored, 'u4'), 'HOLD');
    assert.equal(getSummaryGateTarget(restored, 'color'), 'ENTER');
    assert.equal(restored.summaryModelTargets.bet49, undefined);
    applySummaryGateConfig(restored, { summaryModelMarkets: { u4: false } });
    assert.equal(getSummaryGateTarget(restored, 'u4'), null);
});

test('ML Override and Unified do not bypass the chosen summary gate', () => {
    const settings = config();
    settings.summaryModelMarkets.u4 = true;
    settings.summaryModelTargets.u4 = 'HOLD';
    settings.mlOverrideMode = true;
    settings.unifiedMode = true;
    assert.equal(summaryGateAllows(settings, 'u4', { betzero: 'ENTER' }), false);
    assert.equal(summaryGateAllows(settings, 'u4', { betzero: 'HOLD' }), true);
    assert.equal(summaryGateAllows(settings, 'u4', {}), false);
});

test('the gate resolves only the issued draw label, including saved legacy metadata', () => {
    const draws = [{ drawId: '21', summaryModel: { betzero: 'HOLD' } },
        { drawId: '20', mlShadow: { u4: { recommendation: 'ENTER' } } }];
    assert.equal(getIssuedSummaryLabels({ drawId: 21, summaryModel: { betzero: 'ENTER' } }, draws).betzero, 'HOLD');
    assert.equal(getIssuedSummaryLabels({ drawId: 20 }, draws).betzero, 'ENTER');
    assert.equal(getIssuedSummaryLabels({ drawId: 22, summaryModel: { betzero: 'HOLD' } }, draws).betzero, 'HOLD');
    assert.equal(getIssuedSummaryLabels({ drawId: 22 }, draws).betzero, null);
    assert.deepEqual(getIssuedSummaryLabels(null, draws), {});
});

test('actual bot gate uses saved labels for execution and telemetry without calling the live model', () => {
    // Load just the gate wrapper, avoiding bot startup, user data, and all network activity.
    const source = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
    const start = source.indexOf('function passesSummaryModelGate(');
    const end = source.indexOf('\nfunction refreshRetrainingModelArtifactFromLog', start);
    assert.ok(start >= 0 && end > start);
    const context = vm.createContext({
        getSummaryGateTarget, summaryGateAllows, getIssuedSummaryLabels,
        lastPrediction: { drawId: '21' },
        predictionLog: [{ drawId: '21', summaryModel: { betzero: 'HOLD' } }]
    });
    vm.runInContext(source.slice(start, end), context);
    const settings = config();
    settings.summaryModelMarkets.u4 = true;
    settings.summaryModelTargets.u4 = 'HOLD';
    assert.equal(context.passesSummaryModelGate({ config: settings }, 'u4'), true);
    assert.equal(context.passesSummaryModelGate({ config: settings }, 'u4', { drawId: '21' }), true);
    assert.equal(context.passesSummaryModelGate({ config: settings }, 'u4', { drawId: '22' }), false);
    settings.summaryModelTargets.u4 = 'ENTER';
    assert.equal(context.passesSummaryModelGate({ config: settings }, 'u4'), false);
});
