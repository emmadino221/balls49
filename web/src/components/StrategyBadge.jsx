import React from 'react';

export default function StrategyBadge({ strategy }) {
  if (!strategy?.label) return null;
  return <span className="summary-model-badge">📌 Strategy: {strategy.label}</span>;
}
