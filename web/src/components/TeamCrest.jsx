import React, { useEffect, useState } from 'react';

const initials = name => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase();

// Club crest from the fixture provider, addressed by its team id. Falls back to the team's
// initials when there is no id (older saved combinations) or the image cannot be loaded.
export default function TeamCrest({ id, name, size = 'md' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [id]);
  return <span className={`rfx-crest rfx-crest-${size}`} aria-hidden="true">
    {id && !failed
      ? <img src={`https://crests.football-data.org/${encodeURIComponent(id)}.png`} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      : <b>{initials(name)}</b>}
  </span>;
}
