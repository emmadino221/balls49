'use strict';
const crypto = require('crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const equal = (a,b) => crypto.timingSafeEqual(Buffer.from(hash(a),'hex'),Buffer.from(hash(b),'hex'));
function base32(bytes) {
    const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits=0,value=0,out='';
    for (const byte of bytes) { value=(value<<8)|byte; bits+=8; while(bits>=5) { bits-=5; out+=alphabet[(value>>>bits)&31]; } }
    if(bits) out+=alphabet[(value<<(5-bits))&31]; return out;
}
function counterFor(secret, code, last) {
    if (!/^\d{6}$/.test(code)) return null;
    const now=Math.floor(Date.now()/30000);
    for (const counter of [now,now-1,now+1]) {
        if(counter<=last) continue;
        const buffer=Buffer.alloc(8); buffer.writeBigUInt64BE(BigInt(counter));
        const digest=crypto.createHmac('sha1',Buffer.from(secret,'hex')).update(buffer).digest();
        const offset=digest[19]&15, number=(digest.readUInt32BE(offset)&0x7fffffff)%1000000;
        if(equal(code,String(number).padStart(6,'0'))) return counter;
    }
    return null;
}
function createOwnerSecurity(db,vault,adminKey) {
    const read=()=>JSON.parse(db.prepare("SELECT setting_value FROM site_settings WHERE setting_key='owner_security'").get().setting_value);
    const save=value=>db.prepare("INSERT INTO site_settings VALUES ('owner_security',?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value").run(JSON.stringify(value));
    if(!db.prepare("SELECT 1 FROM site_settings WHERE setting_key='owner_security'").get()) save({version:crypto.randomBytes(16).toString('hex'),enabled:false});
    const fail=()=>Object.assign(new Error('Owner key or verification code is incorrect, expired, or already used.'),{status:401});
    function keyValid(key) { return !!adminKey && equal(String(key||''),adminKey); }
    function verify(key,code) {
        if(!keyValid(key)) throw fail();
        const state=read();
        if(!state.enabled) return;
        // Bound second-factor guesses across IPs after the correct first factor.
        if (!state.factorWindow || Date.now()-state.factorWindow >= 600000) { state.factorWindow=Date.now(); state.factorAttempts=0; }
        if ((state.factorAttempts||0)>=10) throw Object.assign(new Error('Too many verification attempts. Wait ten minutes before trying again.'),{status:429});
        state.factorAttempts=(state.factorAttempts||0)+1; save(state);
        const supplied=String(code||'').trim();
        const counter=counterFor(vault.open(state.secret),supplied,state.lastCounter??-1);
        if(counter!==null) { state.lastCounter=counter; state.factorAttempts=0; save(state); return; }
        const digest=hash(supplied.toLowerCase());
        const index=(state.recovery||[]).findIndex(value=>equal(value,digest));
        if(index<0) throw fail();
        state.recovery.splice(index,1);
        state.factorAttempts=0;
        // A recovery login invalidates older sessions as well as consuming its code.
        state.version=crypto.randomBytes(16).toString('hex'); save(state);
    }
    return {
        version() { return crypto.createHmac('sha256',adminKey).update('owner-session:'+read().version).digest('hex'); },
        status() { const s=read(); return {enabled:s.enabled,recoveryRemaining:s.recovery?.length||0}; },
        verify,
        begin(key) {
            if(!keyValid(key)) throw fail();
            const s=read(); if(s.enabled) throw new Error('Two-factor authentication is already enabled.');
            const secret=crypto.randomBytes(20);
            s.pending={secret:vault.seal(secret.toString('hex')),expires:Date.now()+600000,attempts:0}; save(s);
            return {secret:base32(secret),expiresInSeconds:600};
        },
        confirm(key,code) {
            if(!keyValid(key)) throw fail();
            const s=read(); if(s.enabled||!s.pending||s.pending.expires<Date.now()||s.pending.attempts>=5) throw fail();
            s.pending.attempts++; save(s);
            const counter=counterFor(vault.open(s.pending.secret),String(code||'').trim(),-1);
            if(counter===null) throw fail();
            const codes=Array.from({length:10},()=>crypto.randomBytes(10).toString('hex'));
            s.secret=s.pending.secret; delete s.pending;
            s.enabled=true; s.lastCounter=counter; s.recovery=codes.map(hash); s.version=crypto.randomBytes(16).toString('hex'); save(s);
            return {recoveryCodes:codes};
        },
        disable(key,code) { verify(key,code); save({enabled:false,version:crypto.randomBytes(16).toString('hex')}); },
        revoke(key,code) { verify(key,code); const s=read(); s.version=crypto.randomBytes(16).toString('hex'); delete s.pending; save(s); }
    };
}
module.exports={createOwnerSecurity};
