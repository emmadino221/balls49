import React from 'react';

export default function ContactPage() {
  return (
    <main className="page-wrap">
      <section className="page-intro">
        <span className="overline">Contact</span>
        <h1>Ask Support</h1>
        <p>Reach a friendly Emmy-Bet support desk.</p>
      </section>
      <section className="contact-grid">
        <article className="content-card">
          <form className="auth-form">
            <label>Name</label>
            <input type="text" />
            <label>Email</label>
            <input type="email" />
            <label>Message</label>
            <textarea rows="5" />
            <button className="btn btn-primary">Send Message</button>
          </form>
        </article>
      </section>
    </main>
  );
}
