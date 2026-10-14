import React from 'react';

export default function TotalColorPick({ pick }) {
  if (pick?.status !== 'ACTIVE' || !Array.isArray(pick.topColors)) return <span className="no-pick">No active pick</span>;
  const colors = [...pick.topColors];
  // Historical picks store two colors with an implicit third selection of DRAW.
  if (colors.length === 2 && colors.every(color => ['red', 'blue', 'green'].includes(color))) colors.push('black');
  if (colors.length !== 3 || new Set(colors).size !== 3 || colors.includes(pick.noWinColor)
    || colors.some(color => !['red', 'blue', 'green', 'black'].includes(color))) return <span className="no-pick">No active pick</span>;
  const name = color => color === 'black' ? 'NO WINNING COLOR' : color;
  return (
    <span className="live-market-picks">
      <span className="pick-colors">{colors.map(color => <span className={`color-name color-${color}`} key={color}><i aria-hidden="true" />{name(color)}</span>)}</span>
      <small>Eliminated: {name(pick.noWinColor) || '—'}</small>
    </span>
  );
}
