'use strict';
// VPS-only recovery: OS access to the account database is required.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const [action,file] = process.argv.slice(2);
if (action !== '--disable-2fa' || !file || process.argv.length !== 4 || !path.isAbsolute(file) || !fs.existsSync(file)) {
    console.error('Usage: node owner-security-recovery.js --disable-2fa /absolute/path/to/site_users.sqlite');
    process.exitCode=1;
} else {
    const db=new DatabaseSync(file);
    db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
    try {
        db.prepare("UPDATE site_settings SET setting_value=? WHERE setting_key='owner_security'").run(JSON.stringify({enabled:false,version:crypto.randomBytes(16).toString('hex')}));
        db.prepare("DELETE FROM site_sessions WHERE json_extract(session_json,'$.admin')=1").run();
        db.exec('COMMIT');
        console.log('Owner 2FA disabled and owner sessions revoked. Sign in with the owner key and enroll again.');
    } catch(error) { db.exec('ROLLBACK'); throw error; }
    finally { db.close(); }
}
