'use strict';
const fs = require('fs');
const path = require('path');

const pages = new Set(['index.html', 'account.html', 'analysis.html', 'about.html',
    'football.html', 'pricing.html', 'predictions.html', 'history.html', 'guide.html', 'calculator.html',
    'testimonials.html', 'suggestions.html', 'videos.html', 'contact.html', 'free-trial.html', 'login.html', 'signup.html']);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function createSiteStaticHandler(directory) {
    const root = fs.realpathSync(directory);
    if (!fs.statSync(path.join(root, 'index.html')).isFile()) throw new Error('Build the website before enabling SITE_SERVE_WEB.');
    return async function serveSite(req, res, url) {
        if (!['GET', 'HEAD'].includes(req.method)) return false;
        const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const asset = /^assets\/[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(relative) && types[path.extname(relative)];
        if (!pages.has(relative) && !asset) return false;
        let content;
        try {
            const resolved = await fs.promises.realpath(path.join(root, relative));
            if (!resolved.startsWith(root + path.sep)) return false;
            content = await fs.promises.readFile(resolved);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
            res.end('Page not found.');
            return true;
        }
        res.writeHead(200, {
            'Content-Type': types[path.extname(relative)],
            'Content-Length': content.length,
            'Cache-Control': asset ? 'public, max-age=31536000, immutable' : 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'strict-origin-when-cross-origin'
        });
        res.end(req.method === 'HEAD' ? undefined : content);
        return true;
    };
}
module.exports = { createSiteStaticHandler };
