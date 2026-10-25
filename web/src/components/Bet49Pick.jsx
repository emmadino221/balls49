import React from 'react';
export const bet49Numbers = value => (Array.isArray(value) ? value : value == null ? [] : [value])
  .map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 49);
export default function Bet49Pick({ value }) {
  const numbers = bet49Numbers(value);
  return numbers.length ? <span className="pick-balls">{numbers.map(number => {
    const color = number === 49 ? 'yellow' : number % 3 === 1 ? 'red' : number % 3 === 2 ? 'blue' : 'green';
    return <span className={`ball-number ball-${color}`} key={number}>{number}</span>;
  })}</span> : <span className="no-pick">No active pick this draw</span>;
}
