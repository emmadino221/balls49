'use strict';
// The website and the extension share one saved setup: either may save, but an extension save
// based on settings older than the last save is refused instead of overwriting it.
const assert = require('assert');
const control = require('./automation-control');

const session = () => ({ stats: { isHalted: true, haltReason: '' }, config: {}, automationControl: { controller: 'extension', revision: 7, executorAt: 0, executorToken: '' } });

let s = session();
assert.equal(control.state(s).controller, 'website', 'an old "extension control" session becomes the shared control');

// Extension settings save: needs the revision it loaded.
assert.throws(() => control.command(s, { stakes: { betzero: 100 } }), /changed on the website/, 'save without a revision (old extension, page-load push) is refused');
assert.throws(() => control.command(s, { stakes: { betzero: 100 }, revision: 6 }), /changed on the website/, 'save from an out-of-date form is refused');
assert.equal(control.command(s, { stakes: { betzero: 100 }, revision: 7 }), null, 'save from the current settings goes through to /config');

// Start and stop from the extension need no revision.
assert.equal(control.command(s, { running: true }), null, 'extension start goes through');
s.stats.isHalted = false;
assert.deepEqual(control.command(s, { running: false }), { done: true }, 'extension stop is handled');
assert.equal(s.stats.isHalted, true);
assert.equal(control.state(s).revision, 8, 'a stop bumps the revision so both sides refresh');

// The old switch buttons do nothing (and no longer stop automation).
s.stats.isHalted = false;
assert.deepEqual(control.command(s, { dashboardAction: 'extension' }), { done: true });
assert.deepEqual(control.command(s, { dashboardAction: 'website' }), { done: true });
assert.equal(s.stats.isHalted, false, 'switching control no longer stops a running session');

// Website commands still check the revision their page loaded.
assert.throws(() => control.command(s, { dashboardAction: 'save', revision: 1, settings: {} }), /Refresh the dashboard/);
console.log('shared control tests passed');
