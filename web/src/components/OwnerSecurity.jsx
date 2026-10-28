import React, { useEffect, useState } from 'react';
import { apiRequest } from '../auth';
export default function OwnerSecurity() {
  const [status,setStatus]=useState(null),[key,setKey]=useState(''),[code,setCode]=useState('');
  const [secret,setSecret]=useState(''),[recovery,setRecovery]=useState([]),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{apiRequest('/admin/security').then(setStatus).catch(e=>setNotice(e.message));},[]);
  async function change(action) {
    if (['disable','revoke'].includes(action) && !window.confirm(action==='disable'?'Disable owner two-factor authentication and sign out all owner sessions?':'Sign out all owner sessions, including this one?')) return;
    setBusy(true);setNotice('');
    try {
      const result=await apiRequest('/admin/security',{method:'POST',body:JSON.stringify({action,key,code})});
      setCode('');
      if(result.signedOut) {window.location.reload();return;}
      if(result.secret) {setSecret(result.secret);setNotice('Setup expires in 10 minutes. Add this secret to your authenticator, then enter its code.');}
      if(result.recoveryCodes) {setRecovery(result.recoveryCodes);setSecret('');setKey('');setNotice('Two-factor authentication enabled. Save your recovery codes privately now. Each works once with your owner key.');}
      setStatus(await apiRequest('/admin/security'));
    } catch(e){setNotice(e.message);} finally {setBusy(false);}
  }
  return <section className="content-card owner-security"><h3>Owner security</h3>
    <p>Two-factor authentication: <strong>{status ? status.enabled?'Enabled':'Not enabled':'Loading...'}</strong></p>
    {status?.enabled&&<p>{status.recoveryRemaining} recovery codes remaining. A code cannot be reused; wait for the next authenticator code after signing in.</p>}
    <div className="auth-form">
      <label>Owner key (required for security changes)<input type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} /></label>
      {secret&&<><p>In your authenticator choose Add account → Enter a setup key. Account: Emmy-Bet owner. Type: Time based.</p><label>Setup secret - keep private<input readOnly value={secret} onFocus={e=>e.target.select()} /></label></>}
      {(status?.enabled||secret)&&<label>Authenticator code or unused recovery code<input autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)} maxLength={32} /></label>}
      {status&&!status.enabled&&<button type="button" className="btn btn-primary" disabled={busy||!key} onClick={()=>change(secret?'confirm':'begin')}>{secret?'Confirm and enable 2FA':'Set up authenticator'}</button>}
      {status?.enabled&&<button type="button" className="btn btn-secondary" disabled={busy||!key||!code} onClick={()=>change('disable')}>Disable 2FA</button>}
      <button type="button" className="btn btn-secondary" disabled={busy||!key||(status?.enabled&&!code)} onClick={()=>change('revoke')}>Sign out all owner sessions</button>
    </div>
    {notice&&<p role="status">{notice}</p>}
    {recovery.length>0&&<div><h4>Save these recovery codes now</h4><p>Store them outside this website. They cannot be shown again. Losing both your authenticator and these codes requires VPS recovery.</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{recovery.join('\n')}</pre><button type="button" className="btn btn-secondary" onClick={()=>setRecovery([])}>I saved them - hide codes</button></div>}
  </section>;
}
