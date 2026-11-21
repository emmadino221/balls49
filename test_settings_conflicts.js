'use strict';
// Settings that cannot work together are refused on every save, website or extension.
const assert = require('assert');
const control = require('./automation-control');
const { conflict } = control;
const base = { gapEntry: {}, shadowMode: false, cbMaxLosses: 0, cbCooldown: 0, bzRbRollover: false, hiloRollover: false, tc3Rollover: false, enabledGames: {}, rollover: { enabled: false } };
const check = extra => conflict({ ...base, ...extra });

assert.equal(check({}), null, 'defaults are fine');
for (const flag of ['shadowMode', 'bzRbRollover', 'hiloRollover', 'tc3Rollover'])
    assert.match(check({ gapEntry: { betzero: { enabled: true } }, [flag]: true, cbMaxLosses: 3 }) || '', /Gap playing windows/, `gap windows + ${flag}`);
assert.equal(check({ gapEntry: { betzero: { enabled: true } } }), null, 'gap windows alone are fine');
assert.match(check({ shadowMode: true }), /Shadow mode needs/);
assert.equal(check({ shadowMode: true, cbMaxLosses: 3 }), null, 'shadow with circuit-breaker losses');
assert.match(check({ cbMaxLosses: 3 }), /Cooldown draws/);
assert.equal(check({ cbMaxLosses: 3, cbCooldown: 5 }), null);
assert.match(check({ enabledGames: { bet49: true }, rollover: { enabled: true } }), /opposite ways/);
assert.equal(check({ enabledGames: { bet49: true } }), null);
assert.equal(check({ rollover: { enabled: true } }), null);

// The extension's save path runs the same check, merged with what is already saved.
const session = () => ({ stats: { isHalted: true }, config: { enabledGames: { bet49: true }, rollover: { enabled: false, baseStake: 0, lossSteps: 4 } }, automationControl: { revision: 3 } });
let s = session();
assert.throws(() => control.command(s, { revision: 3, rollover: { enabled: true, baseStake: 100, lossSteps: 4 } }), /opposite ways/, 'popup turns on BZ Single while Bet49 is saved on');
assert.equal(control.command(s, { revision: 3, enabledGames: { bet49: false }, rollover: { enabled: true, baseStake: 100, lossSteps: 4 } }), null, 'turning Bet49 off in the same save is fine');
s = session(); s.config.gapEntry = { betzero: { enabled: true } };
assert.throws(() => control.command(s, { revision: 3, bzRbRollover: true }), /Gap playing windows/, 'popup cannot add a rollover under gap windows');
assert.throws(() => control.command(s, { revision: 3, shadowMode: true }), /Gap playing windows|Shadow mode needs/);
s = session();
assert.throws(() => control.command(s, { revision: 3, cbMaxLosses: 4 }), /Cooldown draws/);
assert.equal(control.command(s, { revision: 3, cbMaxLosses: 4, cbCooldown: 10 }), null);
assert.equal(control.command(s, { running: true }), null, 'start/stop is never blocked by settings checks');
console.log('settings conflict tests passed');
