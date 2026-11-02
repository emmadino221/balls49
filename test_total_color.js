'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { getTotalColorOutcome, totalColor3WayPrediction, getTotalColorTargets, totalColorWins } = require('./total-color');
const { singleColorPrediction } = require('./total-color');
const { predictBet49 } = require('./bet49');
const { predictHighLowFromBet49 } = require('./high-low');

const tie = [1, 4, 2, 5, 3, 6];
const red = [1, 4, 7, 2, 3, 6];
const blue = [2, 5, 8, 1, 3, 6];
const green = [3, 6, 9, 1, 2, 5];
const normal = { status: 'ACTIVE', topColors: ['red', 'blue'], noWinColor: 'green', gap: 0.1, confidence: 0.1 };
const twoWay = { status: 'ACTIVE', top2: ['red', 'blue'], gap: 0.1, confidence: 0.1 };
const draw = (id, numbers) => ({ id, dr: numbers.join(','), total: numbers.reduce((sum, n) => sum + n, 0) });

test('outcome detection handles sole winners, two/three-color ties, and number 49', () => {
    assert.equal(getTotalColorOutcome(red), 'red');
    assert.equal(getTotalColorOutcome(blue), 'blue');
    assert.equal(getTotalColorOutcome(green), 'green');
    assert.equal(getTotalColorOutcome(tie), 'black');
    assert.equal(getTotalColorOutcome([1, 4, 7, 2, 5, 8]), 'black');
    assert.equal(getTotalColorOutcome([1, 4, 2, 5, 3, 49]), 'black');
    assert.equal(getTotalColorOutcome([3, 6, 9, 1, 2, 49]), 'green');
    for (const invalid of [[], [1, 2, 3], [1, 1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 50]]) {
        assert.equal(getTotalColorOutcome(invalid), null);
    }
});

test('three-way reuses the active two-way colors and adds No Winning Color', () => {
    const pick = totalColor3WayPrediction(twoWay);
    assert.equal(pick.status, 'ACTIVE');
    assert.equal(pick.noWinColor, 'green');
    assert.deepEqual(getTotalColorTargets(pick), ['red', 'blue', 'black']);
    assert.deepEqual(normal.topColors, ['red', 'blue']);
    assert.equal(pick.selectionRule, 'TOTAL_COLOR_2_WAY_PLUS_NO_WIN');
    assert.deepEqual(getTotalColorTargets(totalColor3WayPrediction({ ...twoWay, top2: ['blue', 'green'] })), ['blue', 'green', 'black']);
});

test('three-way skips when the source two-way pick is inactive or invalid', () => {
    for (const prediction of [
        null,
        { ...twoWay, status: 'SKIP' },
        { ...twoWay, top2: ['red', 'red'] },
        { ...twoWay, top2: ['red', 'black'] },
        { ...twoWay, top2: ['red', 'blue', 'green'] }
    ]) {
        assert.equal(totalColor3WayPrediction(prediction).status, 'SKIP');
        assert.deepEqual(getTotalColorTargets(totalColor3WayPrediction(prediction)), []);
    }
});

test('three-way wins for either selected color or No Winning Color', () => {
    const pick = totalColor3WayPrediction(twoWay);
    assert.equal(totalColorWins(pick, red), true);
    assert.equal(totalColorWins(pick, blue), true);
    assert.equal(totalColorWins(pick, tie), true);
    assert.equal(totalColorWins(pick, green), false);
    assert.equal(totalColorWins(pick, []), false);
});

test('historical picks retain their saved selections and excluded outcome', () => {
    assert.deepEqual(getTotalColorTargets(normal), ['red', 'blue', 'black']);
    assert.equal(totalColorWins(normal, tie), true);
    assert.equal(totalColorWins(normal, red), true);
    assert.equal(totalColorWins(normal, green), false);
    const persisted = JSON.parse(JSON.stringify({ status: 'ACTIVE', topColors: ['red', 'blue', 'green'], noWinColor: 'black' }));
    assert.equal(totalColorWins(persisted, green), true);
    assert.equal(totalColorWins(persisted, tie), false);
});

test('invalid or skipped selections cannot become valid three-way bets', () => {
    for (const pick of [null, { ...normal, status: 'SKIP' }, { ...normal, topColors: ['red', 'red'] },
        { ...normal, topColors: ['red', 'blue', 'green', 'black'] }, { ...normal, topColors: ['red', 'blue', 'green'] }]) {
        assert.deepEqual(getTotalColorTargets(pick), []);
    }
});

test('actual generator builds three-way from the active two-way prediction', () => {
    const source = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
    const start = source.indexOf('function computePredictions(');
    const end = source.indexOf('\nfunction processUpdates', start);
    assert.ok(start >= 0 && end > start);
    const context = vm.createContext({
        totalColor3WayPrediction,
        getDailyHistoryResetAt: () => 0,
        getBallColor: number => number === 49 ? 'yellow' : number % 3 === 1 ? 'red' : number % 3 === 2 ? 'blue' : 'green',
        predictBet49,
        predictHighLowFromBet49,
        singleColorPrediction
    });
    vm.runInContext(source.slice(start, end), context);
    const predict = numbers => {
        const draws = Array.from({ length: 20 }, (_, index) => draw(100 - index, numbers));
        return context.computePredictions({ data: { draws } }, null, null, null, null, null, 101);
    };
    const tiedPrediction = predict(tie);
    assert.equal(tiedPrediction.totalColor2Pred.status, 'SKIP');
    assert.equal(tiedPrediction.totalColorPred.status, 'SKIP');
    const prediction = predict(red);
    assert.equal(prediction.totalColor2Pred.status, 'ACTIVE');
    assert.deepEqual(getTotalColorTargets(prediction.totalColorPred), [...prediction.totalColor2Pred.top2, 'black']);
    assert.equal(prediction.totalColorPred.noWinColor, 'blue');
});

function extensionHarness({ missingButton = null, placementSuccess = true } = {}) {
    const source = fs.readFileSync(path.join(__dirname, 'balls49-extension/content.js'), 'utf8');
    const start = source.indexOf('async function runTotalColor(');
    const end = source.indexOf('\nasync function runTotalColor2(', start);
    assert.ok(start >= 0 && end > start);
    const placed = [];
    const input = { value: 0, dispatchEvent() {} };
    let selected = null;
    const context = vm.createContext({
        document: { querySelector(selector) {
            if (selector === '.total-colour') return null;
            if (selector === 'input[type="number"]') return input;
            const color = selector.replace('.g-total__btn.', '');
            return color === missingButton ? null : { color };
        } },
        safeClick(button) { selected = button.color; },
        sleep: async () => {},
        Event: class {},
        currentPlacementReport: null,
        placeBet: async () => { placed.push({ color: selected, stake: input.value }); return placementSuccess; }
    });
    vm.runInContext(source.slice(start, end), context);
    return { run: context.runTotalColor, placed };
}

test('extension places the two selected colors and No Winning Color', async () => {
    const extension = extensionHarness();
    assert.equal(await extension.run(getTotalColorTargets(totalColor3WayPrediction(twoWay)), 100), true);
    assert.deepEqual(extension.placed, ['red', 'blue', 'black'].map(color => ({ color, stake: 100 })));
});

test('extension supports normal explicit payloads and older two-color payloads', async () => {
    for (const targets of [getTotalColorTargets(normal), ['red', 'blue']]) {
        const extension = extensionHarness();
        assert.equal(await extension.run(targets, 100), true);
        assert.deepEqual(extension.placed.map(item => item.color), ['red', 'blue', 'black']);
    }
});

test('extension rejects invalid selections, missing buttons, and failed placements', async () => {
    const extension = extensionHarness();
    assert.equal(await extension.run(['red', 'red', 'green'], 100), false);
    assert.equal(extension.placed.length, 0);
    const missing = extensionHarness({ missingButton: 'green' });
    assert.equal(await missing.run(['red', 'blue', 'green'], 100), false);
    assert.equal(missing.placed.length, 0);
    const failed = extensionHarness({ placementSuccess: false });
    assert.equal(await failed.run(['red', 'blue', 'green'], 100), false);
});
