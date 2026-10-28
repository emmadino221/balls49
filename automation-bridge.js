"use strict";
const crypto = require('crypto');
function createAutomationBridge(db, secret, vault) {
 db.exec('CREATE TABLE IF NOT EXISTS site_automation_links (account TEXT PRIMARY KEY, client_id TEXT NOT NULL UNIQUE, encrypted_key TEXT NOT NULL)');
 const key = crypto.createHash('sha256').update('automation-link-v1:' + secret).digest();
 const get = account => db.prepare('SELECT * FROM site_automation_links WHERE account = ?').get(account);
 const failure = (message,status=400) => Object.assign(new Error(message),{status});
 function encrypt(value) { return 'v2:' + vault.seal(value); }
 function decrypt(value) {
  try {
   if (value.startsWith('v2:')) return vault.open(value.slice(3));
   const [iv,tag,body] = value.split('.').map(v=>Buffer.from(v,'base64'));
   const cipher=crypto.createDecipheriv('aes-256-gcm',key,iv); cipher.setAuthTag(tag);
   return Buffer.concat([cipher.update(body),cipher.final()]).toString('utf8');
  } catch { throw failure('Stored key cannot be decrypted. Restore the site vault key or relink the extension.',409); }
 }
 // Migration is atomic; retain the old owner key until this startup succeeds.
 const migrations = db.prepare('SELECT account, encrypted_key FROM site_automation_links').all();
 const converted = migrations.map(row=>({...row, value:encrypt(decrypt(row.encrypted_key))}));
 db.exec('BEGIN IMMEDIATE');
 try {
  for (const row of converted) db.prepare('UPDATE site_automation_links SET encrypted_key=? WHERE account=?').run(row.value,row.account);
  db.exec('COMMIT');
 } catch(error) { db.exec('ROLLBACK'); throw error; }
 async function core(token, action, body) {
  let response; try { response = await fetch(`http://127.0.0.1:3001/extension/${action}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type':'application/json' }, body: body ? JSON.stringify(body) : undefined, redirect:'error', signal:AbortSignal.timeout(8000) }); } catch { throw failure('Betting worker is unavailable. Automation status cannot be confirmed.',503); }
  const result = await response.json(); if (!response.ok) throw failure(result.error || 'Worker rejected this request.',response.status); return result;
 }
 return {
  async revokeAccount(account, hadSubscription) {
   const link = get(account);
   if (account === '__owner__') return;
   await require('./extension-subscriptions').request({ action: 'revoke-account', email: account, clientId: link?.client_id }, process.env.PREDICTION_INGEST_SECRET || '');
  },
  async subscription(account, expiresAt) {
   if (!secret) throw new Error('Configure the website admin key before issuing access.');
   const link = get(account);
   const token = link ? decrypt(link.encrypted_key) : crypto.randomBytes(32).toString('hex');
   const result = await require('./extension-subscriptions').request({ email: account, expiresAt, key: token }, process.env.PREDICTION_INGEST_SECRET || '');
   db.prepare('INSERT INTO site_automation_links VALUES (?,?,?) ON CONFLICT(account) DO UPDATE SET client_id=excluded.client_id, encrypted_key=excluded.encrypted_key').run(account,result.clientId,encrypt(token));
   return { expiresAt, key: token };
  },
  credential(account) { const link = get(account); return link ? decrypt(link.encrypted_key) : null; },
  async link(account,token) { if (!secret) throw failure('Website admin key is required for encrypted linking.',503); if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw failure('Enter your extension access key.'); const status = await core(token,'stats?dashboard=1'); if (!status.clientId || !status.control) throw failure('Update the betting worker before linking.',409); if (account !== '__owner__') await require('./extension-subscriptions').request({action:'bind-account',email:account,key:token},process.env.PREDICTION_INGEST_SECRET || ''); const linked = db.prepare('SELECT account FROM site_automation_links WHERE client_id = ?').get(status.clientId); if (linked && linked.account !== account) throw failure('This extension session is already linked to another account.',409); if (get(account) && get(account).client_id !== status.clientId) throw failure('Unlink your current session first.',409); db.prepare('INSERT INTO site_automation_links VALUES (?,?,?) ON CONFLICT(account) DO UPDATE SET encrypted_key=excluded.encrypted_key').run(account,status.clientId,encrypt(token)); return { linked:true }; },
  async status(account) { const link=get(account); if (!link) return {linked:false}; const data=await core(decrypt(link.encrypted_key),'stats?dashboard=1'); return {linked:true,...data}; },
  async command(account,input) { const link=get(account); if (!link) throw failure('Link an extension first.'); if (!['website','extension','start','stop','save','unlink','reset'].includes(input.action)) throw failure('Invalid action.'); const token=decrypt(link.encrypted_key); if (input.action === 'reset') { if (!Number.isSafeInteger(input.revision)) throw failure('Refresh the dashboard before resetting.',409); return core(token,`reset?dashboardReset=1&revision=${input.revision}`,{}); } const result=await core(token,'config',{dashboardAction:input.action==='unlink'?'stop':input.action,revision:input.revision,settings:input.settings}); if (input.action==='unlink' && account !== '__owner__') await require('./extension-subscriptions').request({action:'bind-account',email:account,key:token},process.env.PREDICTION_INGEST_SECRET || ''); if (input.action==='unlink') db.prepare('DELETE FROM site_automation_links WHERE account=?').run(account); return result; }
 };
}
module.exports={createAutomationBridge};
