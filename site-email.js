"use strict";
const crypto = require('crypto');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function createSiteEmail(db, { apiKey, from, publicUrl }) {
    db.exec(`CREATE TABLE IF NOT EXISTS site_email_codes (
        email TEXT PRIMARY KEY, challenge_hash TEXT NOT NULL UNIQUE, code_hash TEXT NOT NULL,
        name TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        sent_at INTEGER NOT NULL, window_at INTEGER NOT NULL, sends INTEGER NOT NULL
    );`);
    db.prepare('DELETE FROM site_email_codes WHERE sent_at < ?').run(Date.now() - 24 * 3600000);
    const byEmail = db.prepare('SELECT * FROM site_email_codes WHERE email = ?');
    const byChallenge = db.prepare('SELECT * FROM site_email_codes WHERE challenge_hash = ?');
    function failure(message, status = 400) { return Object.assign(new Error(message), { status }); }
    async function send(to, subject, text, html) {
        if (!apiKey || !from) throw failure('Email delivery is not configured. Please contact the site owner.', 503);
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, to: [to], subject, text, html }), signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) {
            console.error(`[SiteEmail] Delivery provider returned HTTP ${response.status}.`);
            throw failure('We could not send your email. Please try again shortly.', 503);
        }
    }
    async function issue(email, name) {
        if (!apiKey || !from) throw failure('Email delivery is not configured. Please contact the site owner.', 503);
        const now = Date.now();
        db.prepare('DELETE FROM site_email_codes WHERE sent_at < ?').run(now - 24 * 3600000);
        const previous = byEmail.get(email);
        if (previous && now - previous.sent_at < 60000) throw failure('Please wait one minute before requesting another code.', 429);
        const sameWindow = previous && now - previous.window_at < 3600000;
        if (sameWindow && previous.sends >= 3) throw failure('Too many email requests. Please try again in an hour.', 429);
        const challenge = crypto.randomBytes(32).toString('hex');
        const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
        db.prepare(`INSERT INTO site_email_codes VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
            ON CONFLICT(email) DO UPDATE SET challenge_hash=excluded.challenge_hash, code_hash=excluded.code_hash,
            name=excluded.name, expires_at=excluded.expires_at, attempts=0, sent_at=excluded.sent_at,
            window_at=excluded.window_at, sends=excluded.sends`).run(email, hash(challenge), hash(challenge + ':' + code), name,
                now + 10 * 60000, now, sameWindow ? previous.window_at : now, sameWindow ? previous.sends + 1 : 1);
        const url = new URL('/verify-email.html', publicUrl);
        url.hash = challenge;
        try {
            await send(email, 'Your Emmy-Bet verification code',
                `Hi ${name},\n\nYour verification code is ${code}. It expires in 10 minutes.\nOpen ${url} to enter the code and choose your password.\nIf you did not request this, ignore this email. Never share your code.`,
                `<div style="font-family:Arial,sans-serif;max-width:520px;padding:28px;background:#f3f8f5;color:#173a2b;border-radius:18px"><h2>Verify your email</h2><p>Hi ${escapeHtml(name)},</p><p>Use this code to finish creating your Emmy-Bet account.</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px">${code}</p><p>Expires in 10 minutes.</p><p><a href="${escapeHtml(url.toString())}">Verify email and choose a password</a></p><p>If you did not request this, ignore this email. Never share your code.</p></div>`);
        } catch (error) {
            // Invalidate only this failed delivery, preserving rate-limit counters and any newer request.
            db.prepare('UPDATE site_email_codes SET expires_at = 0 WHERE challenge_hash = ?').run(hash(challenge));
            if (error.status) throw error;
            throw failure('We could not send your email. Please try again shortly.', 503);
        }
        return { challenge, expiresInSeconds: 600, message: 'Check your inbox for your six-digit verification code.' };
    }
    function read(challenge) {
        if (!/^[a-f0-9]{64}$/.test(challenge)) return null;
        const row = byChallenge.get(hash(challenge));
        return row && row.expires_at > Date.now() ? row : null;
    }
    function check(challenge, code) {
        const row = read(challenge);
        if (!row || row.attempts >= 5) throw failure('This code expired or reached its attempt limit. Request a new code.');
        db.prepare('UPDATE site_email_codes SET attempts = attempts + 1 WHERE challenge_hash = ?').run(hash(challenge));
        if (!/^\d{6}$/.test(code) || !crypto.timingSafeEqual(Buffer.from(row.code_hash, 'hex'), Buffer.from(hash(challenge + ':' + code), 'hex'))) {
            throw failure('The code is incorrect. Check your latest email or request a new code.');
        }
        return row;
    }
    function consume(challenge) { db.prepare('DELETE FROM site_email_codes WHERE challenge_hash = ?').run(hash(challenge)); }
    async function welcome(email, name) {
        const url = new URL('/account.html', publicUrl).toString();
        await send(email, 'Welcome to Emmy-Bet',
            `Welcome, ${name}!\nYour email is verified and your account is ready.\nView your account: ${url}\nPremium and Elite plans still require owner approval.`,
            `<div style="font-family:Arial,sans-serif;max-width:520px;padding:28px;background:#f3f8f5;color:#173a2b;border-radius:18px"><h2>Welcome to Emmy-Bet</h2><p>Hi ${escapeHtml(name)}, your email is verified and your account is ready.</p><p><a href="${escapeHtml(url)}">View your account</a></p><p>Premium and Elite plans still require owner approval.</p></div>`);
    }
    return { issue, read, check, consume, welcome, pending: email => byEmail.get(email) };
}
module.exports = { createSiteEmail };
