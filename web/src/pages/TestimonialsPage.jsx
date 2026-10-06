import React from 'react';

const principles = [
  { number: '01', title: 'Clarity first', text: 'Signals are presented with their market and status so you can understand what is being suggested.' },
  { number: '02', title: 'Room to decide', text: 'A prediction is information, not an instruction. You choose whether it fits your own limits.' },
  { number: '03', title: 'Honest outcomes', text: 'Results should be reviewed over time, including losing runs and skipped markets.' },
];

export default function TestimonialsPage() {
  return (
    <main className="page-wrap principles-page">
      <section className="page-intro">
        <span className="overline">OUR PRINCIPLES</span>
        <h1>Built for a more considered workflow.</h1>
        <p>We focus on readable signals, useful context, and a clear view of uncertainty—not promises about future results.</p>
      </section>
      <section className="testimonial-grid principles-grid" aria-label="Platform principles">
        {principles.map((item) => (
          <article className="testimonial-card principle-card" key={item.number}>
            <span className="principle-number">{item.number}</span>
            <h2>{item.title}</h2>
            <p>{item.text}</p>
          </article>
        ))}
      </section>
      <section className="principles-note">
        <span className="principles-note-mark" aria-hidden="true">✳</span>
        <div><strong>Predictions are uncertain.</strong><p>Review the public history, set limits that work for you, and never stake money you cannot afford to lose.</p></div>
        <a className="cinematic-text-link" href="history.html">View the track record <span aria-hidden="true">→</span></a>
      </section>
    </main>
  );
}
