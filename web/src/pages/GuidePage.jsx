import React from 'react';

const markets = [
  {
    name: 'BetZero',
    pick: 'A set of four selected numbers.',
    result: 'A win means none of those numbers appeared in the actual draw.',
  },
  {
    name: 'Bet49',
    pick: 'One selected number.',
    result: 'A win means the selected number appeared in the actual draw.',
  },
  {
    name: 'Rainbow Color',
    pick: 'One predicted ball color.',
    result: 'A win means at least two drawn balls match the predicted color.',
  },
  {
    name: 'Total Color (3-way)',
    pick: 'Two target colors and one color to eliminate.',
    result: 'A win means the eliminated color is not the sole most frequent color. A tie for most frequent counts as a win.',
  },
  {
    name: 'Total Color (2-way)',
    pick: 'Two target colors.',
    result: 'A win means the result color is one of the two picks. When colors tie for most frequent, the result is recorded as BLACK.',
  },
  {
    name: 'High / Low',
    pick: 'A prediction of HIGH or LOW based on the draw total.',
    result: 'The prediction wins when it matches the recorded range. Totals up to 148 are LOW, 149–151 are MID, and 152 or more are HIGH. The bot may show no pick when conditions are not met.',
  },
  {
    name: 'Unified',
    pick: 'The bot’s selected market and its corresponding pick.',
    result: 'It is graded using the selected market’s rule above.',
  },
];

export default function GuidePage() {
  return (
    <main className="page-wrap guide-page">
      <section className="page-intro">
        <span className="overline">PREDICTION GUIDE</span>
        <h1>How to read predictions</h1>
        <p>Understand each market, what a result means, and how the history page calculates its summaries.</p>
      </section>

      <section className="guide-section" aria-labelledby="markets-heading">
        <div className="guide-section-heading">
          <span className="overline">MARKET DEFINITIONS</span>
          <h2 id="markets-heading">What each pick means</h2>
        </div>
        <div className="guide-market-grid">
          {markets.map((market) => (
            <article className="guide-market-card" key={market.name}>
              <h3>{market.name}</h3>
              <p><strong>Pick:</strong> {market.pick}</p>
              <p><strong>Win rule:</strong> {market.result}</p>
            </article>
          ))}
        </div>
        <p className="guide-color-key"><strong>Ball color key:</strong> 49 is yellow. Other numbers are mapped by their remainder when divided by 3: remainder 1 is red, 2 is blue, and 0 is green.</p>
      </section>

      <section className="guide-details-grid" aria-label="Reading prediction and history details">
        <article className="content-card guide-detail-card">
          <span className="overline">PREDICTION STATUS</span>
          <h2>ENTER, HOLD, and skipped picks</h2>
          <p><strong>ENTER</strong> and <strong>HOLD</strong> describe the bot’s model recommendation at that time. The displayed model score is a score from the system; it is not a guarantee that a pick will win.</p>
          <p><strong>Skipped</strong> means there was no active pick for that market. Skips are shown for context and are not counted as wins or losses.</p>
        </article>
        <article className="content-card guide-detail-card">
          <span className="overline">HISTORY &amp; WIN RATE</span>
          <h2>How the numbers are calculated</h2>
          <p>For each market, win rate is <strong>wins ÷ (wins + losses)</strong>. Skipped picks are excluded. A market with no settled picks has no win rate yet.</p>
          <p>Maximum losing streak is the greatest number of consecutive losses recorded since the tracking period was last reset.</p>
          <p>Use the draw-range selector to choose recent results or all time. All-time history loads in batches; its summaries reflect the draws currently loaded.</p>
          <a className="text-link guide-history-link" href="history.html">Explore prediction history <span aria-hidden="true">→</span></a>
        </article>
      </section>

      <aside className="guide-note" aria-label="Important information">
        <strong>Keep results in perspective</strong>
        <p>Past results do not predict future draws. Predictions can be wrong; use the information for review, set limits, and never stake money you cannot afford to lose.</p>
      </aside>
    </main>
  );
}
