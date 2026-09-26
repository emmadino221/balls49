import React from 'react';

const previewMarkets = [
  { name: 'BetZero', status: 'Example pick', detail: 'Numbers selected', tone: 'mint' },
  { name: 'Rainbow Color', status: 'Example pick', detail: 'Color signal', tone: 'violet' },
  { name: 'High / Low', status: 'Waiting', detail: 'Conditions not met', tone: 'amber' },
];

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <div className="hero-grid page-container">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> BALLS49 · PREDICTION INSIGHTS</div>
            <h1>A clearer view of every <span>draw.</span></h1>
            <p className="hero-description">
              Follow market signals, understand each pick, and review results in one calm, easy-to-read place.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="free-trial.html">Explore the free trial <span aria-hidden="true">→</span></a>
              <a className="text-link" href="about.html">How it works <span aria-hidden="true">↗</span></a>
            </div>
            <p className="hero-footnote">A decision-support tool. No prediction can guarantee a result.</p>
          </div>

          <div className="prediction-preview" aria-label="Example prediction preview">
            <div className="preview-glow" />
            <div className="preview-header">
              <div>
                <span className="preview-kicker">PREDICTION PREVIEW</span>
                <h2>One message. Clear signals.</h2>
              </div>
              <span className="preview-badge"><span /> Example</span>
            </div>
            <div className="preview-draw"><span className="draw-icon">49</span><span><small>GAME</small><strong>Balls49</strong></span><span className="preview-time">Illustrative only</span></div>
            <div className="preview-market-list">
              {previewMarkets.map((market) => (
                <div className="preview-market" key={market.name}>
                  <span className={`market-dot ${market.tone}`} />
                  <span className="market-copy"><strong>{market.name}</strong><small>{market.detail}</small></span>
                  <span className={`market-status ${market.tone}`}>{market.status}</span>
                </div>
              ))}
            </div>
            <div className="preview-footer"><span className="preview-check">✓</span> Sample layout · not a live prediction</div>
          </div>
        </div>
      </section>

      <section className="section value-section">
        <div className="page-container">
          <div className="section-heading">
            <span className="overline">MADE TO BE CLEAR</span>
            <h2>Useful information, without the noise.</h2>
            <p>See what the signal says, what it means, and what happened next.</p>
          </div>
          <div className="feature-grid">
            <article className="feature-card">
              <span className="feature-number">01</span><span className="feature-icon" aria-hidden="true">◷</span>
              <h3>Timely signals</h3><p>Read each market suggestion and its status before the next draw.</p>
            </article>
            <article className="feature-card">
              <span className="feature-number">02</span><span className="feature-icon" aria-hidden="true">⌁</span>
              <h3>At-a-glance context</h3><p>Keep the selected market, current step, and model confidence together.</p>
            </article>
            <article className="feature-card">
              <span className="feature-number">03</span><span className="feature-icon" aria-hidden="true">▤</span>
              <h3>Built for review</h3><p>Follow signals with a measured approach and review outcomes over time.</p>
            </article>
          </div>
        </div>
      </section>
    </main>
  );
}
