import React, { useMemo, useState } from 'react';

const gameOptions = [
  ['betzero', 'BetZero'],
  ['bet49', 'Bet49'],
  ['rainbow', 'Rainbow Color'],
  ['totalColor', 'Total Color (3-way)'],
  ['totalColor2', 'Total Color (2-way)'], ['totalColor1', 'Winning Color'],
  ['hilo', 'High / Low'],
  ['unified', 'Unified'],
];
const pricePerGame = 10000;
const naira = amount => `₦${amount.toLocaleString('en-NG')}`;

export default function PricingPage() {
  const [selectedGames, setSelectedGames] = useState(['betzero']);
  const premiumTotal = useMemo(() => selectedGames.length * pricePerGame, [selectedGames]);
  function toggleGame(id) {
    setSelectedGames(current => current.includes(id) ? current.filter(game => game !== id) : [...current, id]);
  }

  return (
    <main className="page-wrap pricing-page">
      <section className="page-intro pricing-intro">
        <span className="overline">PLANS &amp; PRICING</span>
        <h1>Choose the access that fits you.</h1>
        <p>Start with one free market, select Premium games individually, or get all eight predictions with Elite.</p>
      </section>

      <section className="pricing-grid pricing-plan-grid" aria-label="Subscription plans">
        <article className="price-card pricing-free-card">
          <div className="section-kicker">FREE TRIAL</div>
          <div className="price">Free</div>
          <p className="plan-card-summary">Try one market and learn how each prediction works.</p>
          <ul><li>Choose one market for each draw</li><li>Prediction appears in the final 10 seconds</li><li>Prediction guide and public history</li></ul>
          <a className="btn btn-secondary" href="free-trial.html">Open Free Trial</a>
        </article>

        <article className="price-card pricing-premium-card">
          <div className="section-kicker">PREMIUM</div>
          <div className="price">{naira(pricePerGame)}<small>/ game / month</small></div>
          <p className="plan-card-summary">Choose the markets you want. Your monthly total updates below.</p>
          <fieldset className="pricing-game-picker">
            <legend>Select Premium games</legend>
            {gameOptions.map(([id, label]) => <label key={id}><input type="checkbox" checked={selectedGames.includes(id)} onChange={() => toggleGame(id)} /><span>{label}</span><small>{naira(pricePerGame)}</small></label>)}
          </fieldset>
          <div className="pricing-total"><span>{selectedGames.length} {selectedGames.length === 1 ? 'game' : 'games'} / month</span><strong>{naira(premiumTotal)}</strong></div>
          <a className="btn btn-secondary" href="signup.html">Create account to request Premium</a>
        </article>

        <article className="price-card pricing-elite-card">
          <div className="section-kicker">ELITE · ALL ACCESS</div>
          <div className="price">{naira(40000)}<small>/ month</small></div>
          <p className="plan-card-summary">The complete package for members who want every market.</p>
          <ul><li>All eight prediction markets included</li><li>Predictions available as soon as they are generated</li><li>Elite Telegram access entitlement</li><li>Save {naira(40000)} vs. eight separate Premium games</li></ul>
          <a className="btn btn-primary" href="signup.html">Create account to request Elite</a>
        </article>
        <article className="price-card">
          <div className="section-kicker">EXTENSION AUTOMATION</div>
          <div className="price">{naira(80000)}<small>/ 30 days</small></div>
          <p className="plan-card-summary">A separate subscription for the browser extension and connected automation dashboard.</p>
          <ul><li>Manual extension or website controls</li><li>Game, stake and progression settings</li><li>Balance and session activity</li><li>Separate owner approval and expiry</li></ul>
          <p>Prediction memberships are sold separately. Elite covers predictions; it does not include extension access.</p>
          <a className="btn btn-primary" href="signup.html">Create account to request extension access</a>
        </article>
      </section>

      <aside className="pricing-approval-note"><strong>Manual plan approval</strong><span>Create an account, then contact the owner to arrange payment and approval for predictions, extension access, or both. Each subscription lasts 30 days per month purchased. Payment processing and automatic Telegram invites are not connected yet.</span></aside>
      <p className="pricing-disclaimer">Prices are monthly in Nigerian naira. Predictions are uncertain and do not guarantee results. Please bet responsibly.</p>
    </main>
  );
}
