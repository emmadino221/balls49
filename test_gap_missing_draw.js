'use strict';
// A draw missing from the worker's history (restart, skipped tick) must not stop gap windows.
const assert = require('assert');
const gap = require('./automation-gap-entry');
// BetZero results: two losses in a row every 5 draws, so loss level 2 has regular gaps.
const record = id => ({ drawId: String(id), result: { betzero: id % 5 === 0 || id % 5 === 1 ? 'LOSS' : 'WIN' } });
const records = [];
for (let id = 1000; id < 1060; id++) records.push(record(id));
const s = { config: { gapEntry: {} }, gapEntryState: {}, automationControl: { controller: 'website' } };
const config = gap.normalize({ betzero: { enabled: true, losses: 2, policy: 'CONTINUOUS_GAP_WINDOWS_V2' } });
gap.configure(s, config, records);
assert.ok(s.gapEntryState.u4.window, 'a window opens from the history');
// Draws 1060-1062 never reach the worker; 1063 onwards do.
const later = [...records]; for (let id = 1063; id < 1075; id++) later.push(record(id));
gap.observe(s, later);
assert.equal(s.gapEntryState.u4.paused, undefined, 'a missing draw does not pause gap windows');
assert.equal(s.gapEntryState.u4.lastSeen, 1074, 'it carries on to the newest draw');
assert.equal(gap.reason(s, 'u4', 1075) === 'Gap entry: waiting for the preceding prediction result.', false);
// A session paused by an older version recovers by itself.
s.gapEntryState.u4.paused = 'Missing draw history. Review and reset the stopped session before continuing windows.';
gap.observe(s, later);
assert.equal(s.gapEntryState.u4.paused, undefined, 'an old missing-draw pause is cleared');
// Seeding across a hole keeps the gaps measured before it.
const holed = records.filter(r => Number(r.drawId) !== 1030);
const t = { config: { gapEntry: {} }, gapEntryState: {}, automationControl: { controller: 'website' } };
gap.configure(t, config, holed);
assert.ok(t.gapEntryState.u4.history.gaps.length >= 8, 'gaps before the hole are kept');
console.log('gap missing-draw tests passed');
