import React from 'react';

const principles = [
  { number: '01', title: 'Clarity first', text: 'Signals are presented with their market and status so you can understand what is being suggested.' },
  { number: '02', title: 'Room to decide', text: 'A prediction is information, not an instruction. You choose whether it fits your own limits.' },
  { number: '03', title: 'Honest outcomes', text: 'Results should be reviewed over time, including losing runs and skipped markets.' },
];

export default function TestimonialsPage() {
  return (
    <main className="page-wrap">
      <section className="page-intro">
        <span className="overline">Our approach</span>
        <h1>Built for a more considered workflow.</h1>
        <p>We focus on readable signals, useful context, and a clear view of uncertainty.</p>
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
    </main>
  );
}
