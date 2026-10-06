import React from 'react';

const principles = [
  { number: '01', title: 'Signals with context', text: 'Market, timing, and prediction status stay together, so a pick is easier to understand.' },
  { number: '02', title: 'A space to review', text: 'Explore seven markets and review recorded picks alongside the actual draw history.' },
  { number: '03', title: 'Room to decide', text: 'Predictions are uncertain information—not guarantees or instructions to place a bet.' },
];

export default function AboutPage() {
  return (
    <main className="page-wrap about-page">
      <section className="page-intro">
        <span className="overline">THE EMMY-BET APPROACH</span>
        <h1>A clearer view of every draw.</h1>
        <p>Emmy-Bet brings prediction signals, market context, and result history into one considered experience.</p>
      </section>
      <section className="about-manifesto content-card">
        <div>
          <span className="section-kicker">OUR PURPOSE</span>
          <h2>Information should be clear.<br /><span>Decisions stay yours.</span></h2>
        </div>
        <p>We present signals with the context to review them: which market they belong to, what was recorded, and how results have unfolded. The goal is a more transparent workflow—not a promise of an outcome.</p>
      </section>
      <section className="about-principles" aria-label="What guides Emmy-Bet">
        {principles.map(item => (
          <article className="about-principle-card" key={item.number}>
            <span>{item.number}</span>
            <h2>{item.title}</h2>
            <p>{item.text}</p>
          </article>
        ))}
      </section>
      <section className="about-next-step">
        <div><span className="overline">EXPLORE THE PLATFORM</span><h2>See the signals for yourself.</h2></div>
        <div className="about-next-actions">
          <a className="btn btn-primary" href="free-trial.html">Try the free market <span aria-hidden="true">↗</span></a>
          <a className="cinematic-text-link" href="guide.html">Read the prediction guide <span aria-hidden="true">→</span></a>
        </div>
      </section>
    </main>
  );
}
