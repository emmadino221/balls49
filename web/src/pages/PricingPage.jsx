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
const pricePerGame = 18000;
const weeklyPricePerGame = 5000;
const naira = amount => `₦${amount.toLocaleString('en-NG')}`;

export default function PricingPage() {
  const [selectedGames, setSelectedGames] = useState(['betzero']);
  const [selectedWeeklyGames, setSelectedWeeklyGames] = useState(['betzero']);
  const premiumTotal = useMemo(() => selectedGames.length * pricePerGame, [selectedGames]);
  const weeklyTotal = useMemo(() => selectedWeeklyGames.length * weeklyPricePerGame, [selectedWeeklyGames]);
  function toggleGame(setGames, id) {
    setGames(current => current.includes(id) ? current.filter(game => game !== id) : [...current, id]);
  }

  return (
    <main className="page-wrap pricing-page">
      <section className="page-intro pricing-intro">
        <span className="overline">PLANS &amp; PRICING</span>
        <h1>Choose the access that fits you.</h1>
        <p>Start with one free market, choose Premium markets, or get all predictions with Elite.</p>
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
          <div className="price">{naira(pricePerGame)}<small>/ game / 30 days</small></div>
          <p className="plan-card-summary">Choose monthly markets. Your total updates below. Need every market for one week? See Weekly Premium.</p>
          <fieldset className="pricing-game-picker">
            <legend>Select Premium games</legend>
            {gameOptions.map(([id, label]) => <label key={id}><input type="checkbox" checked={selectedGames.includes(id)} onChange={() => toggleGame(setSelectedGames, id)} /><span>{label}</span><small>{naira(pricePerGame)}</small></label>)}
          </fieldset>
          <div className="pricing-total"><span>{selectedGames.length} {selectedGames.length === 1 ? 'game' : 'games'} / 30 days</span><strong>{naira(premiumTotal)}</strong></div>
          <a className="btn btn-secondary" href="signup.html">Create account to request Premium</a>
        </article>

        <article className="price-card">
          <div className="section-kicker">PREMIUM · WEEKLY</div>
          <div className="price">{naira(weeklyPricePerGame)}<small>/ selected game / 7 days</small></div>
          <p className="plan-card-summary">Choose the prediction markets you want for one week.</p>
          <fieldset className="pricing-game-picker">
            <legend>Select weekly Premium games</legend>
            {gameOptions.map(([id, label]) => <label key={id}><input type="checkbox" checked={selectedWeeklyGames.includes(id)} onChange={() => toggleGame(setSelectedWeeklyGames, id)} /><span>{label}</span><small>{naira(weeklyPricePerGame)}</small></label>)}
          </fieldset>
          <div className="pricing-total"><span>{selectedWeeklyGames.length} {selectedWeeklyGames.length === 1 ? 'game' : 'games'} / 7 days</span><strong>{naira(weeklyTotal)}</strong></div>
          <a className="btn btn-secondary" href="signup.html">Create account to request weekly access</a>
        </article>

        <article className="price-card pricing-elite-card">
          <div className="section-kicker">ELITE · ALL ACCESS</div>
          <div className="price">{naira(80000)}<small>/ 30 days</small></div>
          <p className="plan-card-summary">Every prediction market in one monthly plan.</p>
          <ul><li>All eight prediction markets included</li><li>Predictions available as soon as they are generated</li><li>Elite Telegram access entitlement</li><li>Save {naira(64000)} vs. eight separate Premium games</li></ul>
          <a className="btn btn-primary" href="signup.html">Create account to request Elite</a>
        </article>
        <article className="price-card">
          <div className="section-kicker">ELITE + EXTENSION · ALL ACCESS</div>
          <div className="price">{naira(120000)}<small>/ 30 days</small></div>
          <p className="plan-card-summary">All predictions plus browser extension automation in one monthly plan.</p>
          <ul><li>All eight prediction markets included</li><li>Browser extension and connected automation dashboard</li><li>Game, stake, progression and session controls</li><li>Owner approval and extension key included</li></ul>
          <a className="btn btn-primary" href="signup.html">Create account to request All Access</a>
        </article>
      </section>

      <aside className="pricing-approval-note"><strong>Manual plan approval</strong><span>Create an account, then contact the owner to arrange payment and approval. Monthly plans last 30 days. Weekly Premium is ₦5,000 per selected game for 7 days. Elite + Extension is monthly-only. Payment processing and automatic Telegram invites are not connected yet.</span></aside>
      <p className="pricing-disclaimer">Prices are in Nigerian naira. Predictions are uncertain and do not guarantee results. Please bet responsibly.</p>
    </main>
  );
}
