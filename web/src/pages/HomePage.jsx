import React from 'react';

const featureCards = [
  {
    number: '01',
    icon: '◷',
    title: 'Signals, in context',
    description: 'See market suggestions, draw timing, and status together—without digging through noisy screens.',
  },
  {
    number: '02',
    icon: '⌁',
    title: 'Seven ways to explore',
    description: 'Compare signals across number, color, total-color, and high / low markets.',
  },
  {
    number: '03',
    icon: '↗',
    title: 'History that tells the story',
    description: 'Review settled outcomes and understand how each signal performed over time.',
  },
];

const orbitBalls = [
  { number: '07', className: 'orbit-ball-one' },
  { number: '18', className: 'orbit-ball-two' },
  { number: '29', className: 'orbit-ball-three' },
  { number: '34', className: 'orbit-ball-four' },
  { number: '41', className: 'orbit-ball-five' },
  { number: '49', className: 'orbit-ball-six' },
];

export default function HomePage() {
  return (
    <main className="home-page">
      <section className="hero cinematic-hero">
        <div className="hero-atmosphere" aria-hidden="true">
          <span className="hero-orb hero-orb-main" />
          <span className="hero-orb hero-orb-small" />
          <span className="hero-grid-lines" />
          {orbitBalls.map((ball) => (
            <span className={`orbit-ball ${ball.className}`} key={ball.number} aria-hidden="true">
              {ball.number}
            </span>
          ))}
        </div>

        <div className="hero-grid page-container cinematic-hero-grid">
          <div className="hero-copy cinematic-hero-copy">
            <div className="eyebrow cinematic-eyebrow">
              <span className="eyebrow-dot" />
              A sharper view of every draw
            </div>
            <h1>Read the game.<br />See <span>what’s next.</span></h1>
            <p className="hero-description">
              Clear prediction insights, live draw context, and a complete result history—all in one considered experience.
            </p>
            <div className="hero-actions cinematic-actions">
              <a className="btn btn-primary cinematic-primary" href="free-trial.html">
                Explore the free trial <span aria-hidden="true">↗</span>
              </a>
              <a className="cinematic-text-link" href="predictions.html">
                Explore predictions <span aria-hidden="true">→</span>
              </a>
            </div>
            <div className="hero-trust-note">
              <span className="hero-trust-mark" aria-hidden="true">✳</span>
              <span>Insights for a more considered approach.<br /><strong>No outcome is guaranteed.</strong></span>
            </div>
          </div>

          <div className="cinematic-stage" aria-label="Illustrative Balls49 prediction interface preview">
            <div className="stage-ambient-ring stage-ring-one" aria-hidden="true" />
            <div className="stage-ambient-ring stage-ring-two" aria-hidden="true" />
            <div className="stage-caption"><span>EMMY-BET / 049</span><span>THE SIGNAL ROOM</span></div>

            <div className="stage-ball stage-ball-large" aria-hidden="true"><span>49</span></div>
            <div className="stage-ball stage-ball-small stage-ball-left" aria-hidden="true"><span>12</span></div>
            <div className="stage-ball stage-ball-small stage-ball-right" aria-hidden="true"><span>31</span></div>

            <div className="signal-card">
              <div className="signal-card-top">
                <div>
                  <span className="signal-eyebrow">SIGNAL SNAPSHOT</span>
                  <h2>Every market.<br /><span>One clear view.</span></h2>
                </div>
                <span className="signal-sample-tag"><i /> SAMPLE</span>
              </div>
              <div className="signal-card-divider" />
              <div className="signal-market-row">
                <span className="signal-market-index">01</span>
                <span className="signal-market-name"><i className="signal-dot signal-dot-green" />Number markets</span>
                <span className="signal-market-count">BETZERO · BET49</span>
              </div>
              <div className="signal-market-row">
                <span className="signal-market-index">02</span>
                <span className="signal-market-name"><i className="signal-dot signal-dot-violet" />Color markets</span>
                <span className="signal-market-count">RAINBOW · TOTAL</span>
              </div>
              <div className="signal-market-row">
                <span className="signal-market-index">03</span>
                <span className="signal-market-name"><i className="signal-dot signal-dot-gold" />Range &amp; unified</span>
                <span className="signal-market-count">HIGH / LOW · MORE</span>
              </div>
              <div className="signal-card-bottom">
                <span className="signal-live-mark" aria-hidden="true">✳</span>
                <span>Illustrative interface preview</span>
                <span className="signal-card-arrow" aria-hidden="true">↗</span>
              </div>
            </div>
            <div className="stage-bottom-label"><span>01 — 07</span><span>CLARITY IN EVERY SIGNAL</span></div>
          </div>
        </div>

        <div className="hero-scroll-cue" aria-hidden="true"><span /> SCROLL TO EXPLORE</div>
      </section>

      <section className="home-proof-strip" aria-label="Platform highlights">
        <div className="page-container proof-strip-inner">
          <div className="proof-brand"><span className="proof-brand-mark">E</span><span>THE GAME, IN A CLEARER LIGHT.</span></div>
          <div className="proof-item"><strong>07</strong><span>Markets to explore</span></div>
          <span className="proof-separator" aria-hidden="true" />
          <div className="proof-item"><strong>LIVE</strong><span>Draw context</span></div>
          <span className="proof-separator" aria-hidden="true" />
          <div className="proof-item"><strong>FULL</strong><span>Result history</span></div>
        </div>
      </section>

      <section className="section value-section cinematic-value-section">
        <div className="page-container">
          <div className="cinematic-section-heading">
            <div>
              <span className="overline">A MORE THOUGHTFUL EXPERIENCE</span>
              <h2>Less noise.<br /><span>More perspective.</span></h2>
            </div>
            <p>Designed to make every signal easier to understand—from the first look to the final result.</p>
          </div>
          <div className="feature-grid cinematic-feature-grid">
            {featureCards.map((feature) => (
              <article className="feature-card cinematic-feature-card" key={feature.number}>
                <div className="cinematic-feature-top">
                  <span className="feature-icon" aria-hidden="true">{feature.icon}</span>
                  <span className="feature-number">{feature.number}</span>
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
                <span className="feature-card-line" aria-hidden="true" />
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="home-final-cta">
        <div className="page-container final-cta-inner">
          <div>
            <span className="overline">YOUR NEXT VIEW STARTS HERE</span>
            <h2>Step into the<br /><span>signal room.</span></h2>
          </div>
          <div className="final-cta-action">
            <p>Explore the free trial and see the experience for yourself.</p>
            <a className="btn btn-primary cinematic-primary" href="free-trial.html">
              Get started <span aria-hidden="true">↗</span>
            </a>
          </div>
          <span className="final-cta-orb" aria-hidden="true" />
        </div>
      </section>
    </main>
  );
}
