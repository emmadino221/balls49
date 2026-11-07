import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../auth.js';
import { acceptClock, clockView, createRefreshLoop } from './betzero-live.mjs';

export function useBetZeroLive(enabled, refreshData) {
  const callback = useRef(refreshData);
  callback.current = refreshData;
  const loop = useRef(null);
  const [clock, setClock] = useState(null);
  const [tick, setTick] = useState(() => ({ mono:performance.now(), wall:Date.now() }));
  const [refreshing, setRefreshing] = useState(false);
  const [clockError, setClockError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [expired, setExpired] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  useEffect(() => {
    if (!enabled) return;
    let mounted = true, accepted = null;
    setExpired(false);
    const cycle = createRefreshLoop({
      visible: () => document.visibilityState !== 'hidden',
      onError(error, authExpired) {
        if (!mounted) return;
        setExpired(authExpired);
        setRefreshError(authExpired ? 'Owner session expired. Sign in again to resume updates.' : error.name === 'AbortError' ? 'Refresh timed out. Retrying automatically.' : error.message);
      },
      async run(signal) {
        setRefreshing(true);
        const clockRequest = async () => {
          const started = performance.now();
          let date;
          try {
            const payload = await apiRequest('/public-clock', { signal, onResponse:r => { date = r.headers.get('Date'); } });
            if (signal.aborted || !mounted) return;
            accepted = acceptClock(payload, {date,started,received:performance.now(),wall:Date.now()}, accepted);
            setClock(accepted);setClockError('');
            setTick({mono:performance.now(),wall:Date.now()});
          } catch (error) {
            if (!signal.aborted && mounted) setClockError(error.message || 'Clock unavailable.');
            throw error;
          }
        };
        try {
          const results = await Promise.allSettled([clockRequest(), callback.current(signal)]);
          if (signal.aborted || !mounted) {
            if (mounted && document.visibilityState !== 'hidden') throw new DOMException('Refresh timed out','AbortError');
            return;
          }
          if (results[1].status === 'fulfilled' && results[1].value !== false) setUpdatedAt(Date.now());
          const errors = results.filter(r=>r.status==='rejected').map(r=>r.reason);
          const error = errors.find(e=>[401,403].includes(e.status)) || errors[0];
          if (error) throw error;
          setRefreshError('');
        } finally { if (mounted) setRefreshing(false); }
      }
    });
    loop.current = cycle;
    cycle.refresh();
    const focus = () => cycle.refresh();
    const visibility = () => cycle.visibility();
    window.addEventListener('focus',focus);
    document.addEventListener('visibilitychange',visibility);
    const ticker = setInterval(()=>{if(document.visibilityState!=='hidden')setTick({mono:performance.now(),wall:Date.now()});},1000);
    return () => { mounted=false;cycle.dispose();clearInterval(ticker);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',visibility);loop.current=null; };
  }, [enabled]);
  const view = clockView(clock,tick.mono,tick.wall,Boolean(clockError));
  return { ...view, clock, clockError, refreshError, expired, refreshing, updatedAt,
    refresh: () => loop.current?.refresh() };
}
