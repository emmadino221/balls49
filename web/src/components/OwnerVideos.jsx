import React, { useEffect, useState } from 'react';
import { apiRequest } from '../auth';
const empty = { id: '', title: '', url: '', description: '' };
export default function OwnerVideos() {
  const [videos, setVideos] = useState([]), [form, setForm] = useState(empty), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  async function load() { const result = await apiRequest('/public-videos'); setVideos(result.videos); }
  useEffect(() => { let active = true; apiRequest('/public-videos').then(r => { if (active) setVideos(r.videos); }).catch(e => { if (active) setNotice(e.message); }); return () => { active = false; }; }, []);
  async function change(payload) {
    if (payload.action === 'delete' && !window.confirm('Remove this video from the website library? The YouTube video itself will remain unchanged.')) return;
    setBusy(true); setNotice('');
    try { await apiRequest('/admin/videos', { method: 'POST', body: JSON.stringify(payload) });
      if (payload.action === 'save' || payload.id === form.id && payload.action === 'delete') setForm(empty);
      setNotice('Video library updated.'); await load();
    } catch (e) { setNotice(e.message); } finally { setBusy(false); }
  }
  return <section className="owner-video-section"><div className="prediction-section-heading"><div><span className="overline">PUBLIC VIDEO LIBRARY</span><h3>Manage your YouTube videos</h3></div><a className="btn btn-secondary" href="videos.html">View library</a></div><p>Add as many videos as you need. Titles, descriptions, and video links are public.</p><form className="auth-form" onSubmit={e => { e.preventDefault(); change({ ...form, action: 'save' }); }}><fieldset disabled={busy} className="video-editor"><legend>{form.id ? 'Edit video' : 'Add video'}</legend><label htmlFor="owner-video-title">Title</label><input id="owner-video-title" value={form.title} maxLength={160} required onChange={e => setForm({ ...form, title: e.target.value })}/><label htmlFor="owner-video-url">YouTube link</label><input id="owner-video-url" type="url" placeholder="https://www.youtube.com/watch?v=..." value={form.url} required onChange={e => setForm({ ...form, url: e.target.value })}/><label htmlFor="owner-video-description">Description (optional)</label><textarea id="owner-video-description" value={form.description} maxLength={2000} rows={3} onChange={e => setForm({ ...form, description: e.target.value })}/><div className="owner-preview-actions"><button className="btn btn-primary">{busy ? 'Saving...' : form.id ? 'Save video' : 'Add video'}</button>{form.id && <button className="btn btn-secondary" type="button" onClick={() => setForm(empty)}>Cancel editing</button>}</div></fieldset></form>{notice && <p role="status">{notice}</p>}
  <div className="owner-video-list">{videos.map((v, i) => <article key={v.id}><strong>{v.title}</strong><div className="owner-preview-actions"><button className="btn btn-secondary" disabled={busy} onClick={() => setForm({ ...v, url: `https://www.youtube.com/watch?v=${v.youtubeId}` })}>Edit</button><button className="btn btn-secondary" disabled={busy || i === 0} aria-label={`Move ${v.title} up`} onClick={() => change({ action: 'move', id: v.id, direction: 'up' })}>Up</button><button className="btn btn-secondary" disabled={busy || i === videos.length - 1} aria-label={`Move ${v.title} down`} onClick={() => change({ action: 'move', id: v.id, direction: 'down' })}>Down</button><button className="btn btn-secondary" disabled={busy} onClick={() => change({ action: 'delete', id: v.id })}>Remove</button></div></article>)}</div></section>;
}
