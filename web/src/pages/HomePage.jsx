import React from 'react';
import WelcomePanel from '../components/WelcomePanel.jsx';
import './home-light.css';

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
    title: 'Eight ways to explore',
    description: 'Compare signals across number, color, total-color, and high / low markets.',
  },
  {
    number: '03',
    icon: '↗',
    title: 'History that tells the story',
    description: 'Review settled outcomes and understand how each signal performed over time.',
  },
];

export default function HomePage() {
  return (
    <main className="home-page">
      <WelcomePanel />

      <section className="home-proof-strip" aria-label="Platform highlights">
        <div className="page-container proof-strip-inner">
          <div className="proof-brand"><span className="proof-brand-mark">E</span><span>THE GAME, IN A CLEARER LIGHT.</span></div>
          <div className="proof-item"><strong>08</strong><span>Markets to explore</span></div>
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
