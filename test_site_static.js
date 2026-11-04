'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createSiteStaticHandler } = require('./site-static');

test('serves the BetZero lab page from the static website allowlist', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'balls49-site-static-'));
    try {
        fs.writeFileSync(path.join(directory, 'index.html'), '<main>Home</main>');
        fs.writeFileSync(path.join(directory, 'betzero-lab.html'), '<main>BetZero lab</main>');
        const serve = createSiteStaticHandler(directory);
        const headers = {};
        let body = '';
        const response = {
            writeHead(status, values) {
                this.statusCode = status;
                Object.assign(headers, values);
            },
            end(value) { body = value?.toString() || ''; }
        };

        assert.equal(await serve({ method: 'GET' }, response, new URL('https://example.test/betzero-lab.html')), true);
        assert.equal(response.statusCode, 200);
        assert.equal(headers['Content-Type'], 'text/html; charset=utf-8');
        assert.equal(body, '<main>BetZero lab</main>');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
