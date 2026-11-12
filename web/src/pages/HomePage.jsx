import React, { useEffect, useRef, useState } from 'react';
import WelcomePanel from '../components/WelcomePanel.jsx';
import useReveal from '../components/useReveal.js';
import './home-light.css';
import './home-page.css';
import './home-motion.css';

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

const calmMotion = () => typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Counts up to the value the first time it scrolls into view.
function CountUp({ to }) {
  const ref = useRef(null);
  const [value, setValue] = useState(to);
  useEffect(() => {
    const node = ref.current;
    if (!node || calmMotion() || typeof IntersectionObserver !== 'function') return undefined;
    let frame = 0;
    setValue(0);
    const observer = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return;
      observer.disconnect();
      const started = performance.now();
      const step = now => {
        const progress = Math.min(1, (now - started) / 1100);
        setValue(Math.round(to * (1 - (1 - progress) ** 3)));
        if (progress < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    }, { threshold: .6 });
    observer.observe(node);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [to]);
  return <strong ref={ref}>{String(value).padStart(2, '0')}</strong>;
}

// Cards lean slightly toward the pointer and carry a soft highlight under it.
function useCardTilt(rootRef, selector) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || calmMotion() || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return undefined;
    let active = null;
    const release = () => { active?.classList.remove('is-tilting'); active = null; };
    const move = event => {
      const card = event.target.closest?.(selector);
      if (card !== active) release();
      if (!card) return;
      active = card;
      const box = card.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width;
      const y = (event.clientY - box.top) / box.height;
      card.classList.add('is-tilting');
      card.style.setProperty('--tilt-x', `${((.5 - y) * 7).toFixed(2)}deg`);
      card.style.setProperty('--tilt-y', `${((x - .5) * 9).toFixed(2)}deg`);
      card.style.setProperty('--glow-x', `${(x * 100).toFixed(1)}%`);
      card.style.setProperty('--glow-y', `${(y * 100).toFixed(1)}%`);
    };
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerleave', release);
    return () => { root.removeEventListener('pointermove', move); root.removeEventListener('pointerleave', release); release(); };
  }, [rootRef, selector]);
}

export default function HomePage() {
  const revealRef = useReveal();
  useCardTilt(revealRef, '.home-destination-card, .cinematic-feature-card');
  return (
    <main className="home-page" ref={revealRef}>
      <WelcomePanel />

      <section className="home-proof-strip" aria-label="Platform highlights">
        <div className="page-container proof-strip-inner" data-reveal>
          <div className="proof-brand"><span className="proof-brand-mark">E</span><span>THE GAME, IN A CLEARER LIGHT.</span></div>
          <div className="proof-item"><CountUp to={8} /><span>Casino markets</span></div>
          <span className="proof-separator" aria-hidden="true" />
          <div className="proof-item"><CountUp to={2} /><span>Football experiences</span></div>
          <span className="proof-separator" aria-hidden="true" />
          <div className="proof-item"><strong>TRACKED</strong><span>Recorded outcomes</span></div>
        </div>
      </section>

      <section className="section value-section cinematic-value-section">
        <div className="page-container">
          <div className="cinematic-section-heading" data-reveal>
            <div>
              <span className="overline">A MORE THOUGHTFUL EXPERIENCE</span>
              <h2>Less noise.<br /><span>More perspective.</span></h2>
            </div>
            <p>Designed to make every signal easier to understand—from the first look to the final result.</p>
          </div>
          <div className="feature-grid cinematic-feature-grid">
            {featureCards.map((feature, index) => (
              <article className="feature-card cinematic-feature-card" key={feature.number} data-reveal style={{ '--reveal-index': index }}>
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
        <div className="page-container final-cta-inner" data-reveal>
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
          <span className="final-cta-orb" aria-hidden="true"><i className="is-red" /><i className="is-blue" /><i className="is-green" /><i className="is-yellow" /></span>
        </div>
      </section>
    </main>
  );
}
