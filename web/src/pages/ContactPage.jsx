import React from 'react';

export default function ContactPage() {
  return (
    <main className="page-wrap contact-page">
      <section className="page-intro">
        <span className="overline">CONTACT &amp; SUPPORT</span>
        <h1>How can we help?</h1>
        <p>Send a message to the Emmy-Bet support team. Include the page or feature you need help with.</p>
      </section>
      <section className="contact-grid">
        <aside className="contact-aside">
          <span className="contact-aside-kicker">WE’RE HERE TO HELP</span>
          <span className="contact-aside-mark" aria-hidden="true">✳</span>
          <h2>Let’s get you pointed in the right direction.</h2>
          <p>For help understanding a market or reading your history, the prediction guide may have the answer.</p>
          <a className="cinematic-text-link" href="guide.html">Open the prediction guide <span aria-hidden="true">→</span></a>
          <div className="contact-aside-foot"><span className="contact-status-dot" /> Emmy-Bet support</div>
        </aside>
        <article className="content-card contact-form-card">
          <div className="contact-form-heading"><span className="section-kicker">SEND A MESSAGE</span><h2>Tell us what’s on your mind.</h2><p>Fields marked with * are required.</p></div>
          <form className="auth-form contact-form">
            <label htmlFor="contact-name">Name <span aria-hidden="true">*</span></label>
            <input id="contact-name" name="name" type="text" autoComplete="name" required />
            <label htmlFor="contact-email">Email <span aria-hidden="true">*</span></label>
            <input id="contact-email" name="email" type="email" autoComplete="email" required />
            <label htmlFor="contact-message">Message <span aria-hidden="true">*</span></label>
            <textarea id="contact-message" name="message" rows="5" required />
            <button className="btn btn-primary">Send Message</button>
          </form>
        </article>
      </section>
    </main>
  );
}
