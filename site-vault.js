'use strict';
const fs = require('fs');
const crypto = require('crypto');
function createSiteVault(file) {
    // Store independently of both the database and the owner login credential.
    try { fs.writeFileSync(file, crypto.randomBytes(32), { flag:'wx', mode:0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const key = fs.readFileSync(file);
    if (key.length !== 32) throw new Error('Invalid site vault key file. Restore the original key backup.');
    return {
        seal(value) {
            const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm',key,iv);
            const body = Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
            return [iv,cipher.getAuthTag(),body].map(b=>b.toString('base64')).join('.');
        },
        open(value) {
            const [iv,tag,body] = value.split('.').map(v=>Buffer.from(v,'base64'));
            const cipher = crypto.createDecipheriv('aes-256-gcm',key,iv); cipher.setAuthTag(tag);
            return Buffer.concat([cipher.update(body),cipher.final()]).toString('utf8');
        }
    };
}
module.exports = { createSiteVault };
