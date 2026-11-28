import React, { useEffect, useState } from 'react';

// Mirrors the extension's wall-clock elapsed time, including paused periods.
export default function AutomationRuntime({ startedAt, online, stale }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);
  const known = Number.isSafeInteger(startedAt) && startedAt >= 0;
  const seconds = known && startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const elapsed = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(n => String(n).padStart(2, '0')).join(':');
  const note = !known ? 'Waiting for updated extension'
    : stale || !online ? 'Last reported start; extension offline or status stale'
    : !startedAt ? 'Waiting for first bet' : 'Elapsed since first bet, including pauses';
  return <span className="ba-board-cell" title={note}>
    <small>Runtime</small>
    <b role="timer" aria-live="off" aria-label={`Session runtime: ${known ? elapsed : 'unavailable'}`}>{known ? elapsed : '--:--:--'}</b>
    <small>{note}</small>
  </span>;
}
