'use strict';
// Every page the build creates must also be served by the website, and every route the
// React router knows must be built. A page missing from site-static.js answers "Not found."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSiteStaticHandler } = require('./site-static');

const built = [...fs.readFileSync(path.join(__dirname, 'web/scripts/create-route-pages.mjs'), 'utf8')
    .matchAll(/'([a-z0-9-]+\.html)'/g)].map(m => m[1]);
const routed = [...fs.readFileSync(path.join(__dirname, 'web/src/router.jsx'), 'utf8')
    .matchAll(/route === '([a-z0-9-]+\.html)'/g)].map(m => m[1]);

test('every built page is served and every routed page is built', async t => {
    assert.ok(built.includes('virtual-automation.html'));
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'site-pages-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    for (const page of ['index.html', ...built]) fs.writeFileSync(path.join(directory, page), `<html>${page}</html>`);
    const serve = createSiteStaticHandler(directory);
    for (const page of built) {
        let status = 0;
        const res = { writeHead: code => { status = code; }, end() {} };
        const handled = await serve({ method: 'GET' }, res, new URL(`https://site.test/${page}`));
        assert.ok(handled && status === 200, `${page} is built but not served`);
    }
    for (const page of routed.filter(p => p !== 'index.html')) assert.ok(built.includes(page), `${page} is routed but not built`);
});
