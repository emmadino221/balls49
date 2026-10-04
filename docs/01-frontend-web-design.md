# Balls49 Web and Extension Design

## Current UI architecture

The website is a React application built with Vite, not a collection of independent static HTML pages. `web/src/router.jsx` maps the public `.html`-style URLs to page components, `web/src/pages/` contains those screens, and `web/emmy-bet.css` provides the shared visual system. Build it from `web/` with `npm run build`.

The Chrome extension is a separate Manifest V3 app in `balls49-extension/`. Its popup manages local automation settings; its content script reads bot instructions, operates the Bet9ja page, and renders the live overlay.

## Website pages and current experience

The route set includes Home, About, Pricing, Testimonials, History, Guide, Calculator, Predictions, Free Trial, Contact, Login, and Signup. The visual direction is a responsive, readable prediction product: clear page headings, market navigation, distinct live/settled states, color-coded draw balls and color picks, and accessible loading and locked-access messages.

The Predictions page provides seven markets: BetZero, Bet49, Rainbow Color, Total Color (3-way), Total Color (2-way), High/Low, and Unified. Signed-in users can save a separate personal base stake for each accessible market. Once locked, the page displays the recommended calculator stake at the current step; a loss advances that market, a win resets it to Step 1, and a skip leaves the step unchanged. These website plans are informational and do not place bets or configure the extension.

Other surfaces include the Free Trial page (one visitor-selected market, revealed during the final ten seconds), prediction history, a market guide, and a martingale calculator. The current-prediction API includes the prediction update timestamp; the page displays it using the browser's local date and time.

## Extension and API boundary

The extension consists of `manifest.json`, `background.js`, `popup.html`, `popup.js`, and `content.js`. In local operation it connects to the private worker at `http://localhost:3001`. The content script processes `/stream` payloads, performs market-specific interactions (including Bet49 as a standalone market), sends `/ack`, and presents the selected market and step in its overlay. Unified automation remains distinct from standalone Bet49.

The React site calls the account, prediction, history, and clock APIs via `web/src/auth.js`; local Vite development proxies API requests to the bot. In public hosting mode, the website talks to the hosted read/account API while the private worker publishes sanitized snapshots through the signed ingestion endpoint. Do not expose the automation API to the public site.

## Design and implementation rules

- Keep market names, result states, and access messaging consistent across prediction, history, trial, guide, and pricing pages.
- Preserve responsive layouts, semantic headings/labels, keyboard-operable tabs, and visible error messages.
- Keep live prediction data and timestamps distinct from historical settled records.
- Treat all API text as untrusted; render React text normally rather than injecting it as HTML.
- Keep stake figures clearly labeled as estimates; no website stake plan should imply a bet was placed.
- Never place server secrets in React source or `VITE_*` values.

## Validation

Run `npm run build` from `web/` after website changes. Run `node --check` on changed extension JavaScript files and load the unpacked extension against the intended game page to validate live DOM selectors; a build cannot verify third-party page selectors.
