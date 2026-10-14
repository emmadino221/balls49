'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { getTotalColorOutcome, applyPreviousDrawRule, getTotalColorTargets, totalColorWins } = require('./total-color');

const tie = [1, 4, 2, 5, 3, 6];
const red = [1, 4, 7, 2, 3, 6];
const blue = [2, 5, 8, 1, 3, 6];
const green = [3, 6, 9, 1, 2, 5];
const normal = { status: 'ACTIVE', topColors: ['red', 'blue'], noWinColor: 'green', gap: 0.1, confidence: 0.1 };
const draw = (id, numbers) => ({ id, dr: numbers.join(','), total: numbers.reduce((sum, n) => sum + n, 0) });
const afterTie = () => applyPreviousDrawRule(normal, [draw(100, tie)], 101);

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

test('only the immediately preceding completed DRAW triggers red + blue + green', () => {
    const pick = afterTie();
    assert.equal(pick.status, 'ACTIVE');
    assert.equal(pick.noWinColor, 'black');
    assert.deepEqual(getTotalColorTargets(pick), ['red', 'blue', 'green']);
    assert.deepEqual(normal.topColors, ['red', 'blue']);
    for (const draws of [[], [draw(99, tie)], [draw(101, tie)], [draw(100, red)], [draw(100, [1, 2, 3])]]) {
        assert.equal(applyPreviousDrawRule(normal, draws, 101), normal);
    }
});

test('after DRAW: each sole color wins and another DRAW loses', () => {
    const pick = afterTie();
    for (const numbers of [red, blue, green]) assert.equal(totalColorWins(pick, numbers), true);
    assert.equal(totalColorWins(pick, tie), false);
    assert.equal(totalColorWins(pick, [1, 4, 7, 2, 5, 8]), false);
    assert.equal(totalColorWins(pick, []), false);
});

test('consecutive DRAWs keep the three colors; a sole color returns to the normal filter', () => {
    const next = applyPreviousDrawRule(normal, [draw(101, tie), draw(100, tie)], 102);
    assert.deepEqual(getTotalColorTargets(next), ['red', 'blue', 'green']);
    assert.equal(applyPreviousDrawRule(normal, [draw(102, green), draw(101, tie)], 103), normal);
});

test('historical two-color picks still include DRAW and lose only to the eliminated color', () => {
    assert.deepEqual(getTotalColorTargets(normal), ['red', 'blue', 'black']);
    assert.equal(totalColorWins(normal, tie), true);
    assert.equal(totalColorWins(normal, red), true);
    assert.equal(totalColorWins(normal, green), false);
    const persisted = JSON.parse(JSON.stringify(afterTie()));
    assert.equal(totalColorWins(persisted, tie), false);
});

test('invalid or skipped selections cannot become valid three-way bets', () => {
    for (const pick of [null, { ...normal, status: 'SKIP' }, { ...normal, topColors: ['red', 'red'] },
        { ...normal, topColors: ['red', 'blue', 'green', 'black'] }, { ...normal, topColors: ['red', 'blue', 'green'] }]) {
        assert.deepEqual(getTotalColorTargets(pick), []);
    }
});

test('actual generator applies the DRAW rule even when the ordinary confidence filter would skip', () => {
    const source = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
    const start = source.indexOf('function computePredictions(');
    const end = source.indexOf('\nfunction processUpdates', start);
    assert.ok(start >= 0 && end > start);
    const context = vm.createContext({ applyPreviousDrawRule });
    vm.runInContext(source.slice(start, end), context);
    const predict = numbers => context.computePredictions({ data: { draws: [draw(100, numbers)] } }, null, null, null, null, null, 101);
    const prediction = predict(tie);
    assert.equal(prediction.rainbowStatus, 'SKIP');
    assert.deepEqual(getTotalColorTargets(prediction.totalColorPred), ['red', 'blue', 'green']);
    assert.equal(predict(red).totalColorPred.status, 'SKIP');
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
        placeBet: async () => { placed.push({ color: selected, stake: input.value }); return placementSuccess; }
    });
    vm.runInContext(source.slice(start, end), context);
    return { run: context.runTotalColor, placed };
}

test('extension places exactly red, blue, green after DRAW and never adds a black bet', async () => {
    const extension = extensionHarness();
    assert.equal(await extension.run(getTotalColorTargets(afterTie()), 100), true);
    assert.deepEqual(extension.placed, ['red', 'blue', 'green'].map(color => ({ color, stake: 100 })));
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
