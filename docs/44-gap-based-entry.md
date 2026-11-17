# Gap-based entry: one execution per trigger

Defaults off. Deployment does not enable the feature or change live settings.

## Setup

Use website control, stop automation, finish any active recovery/execution, then
open Settings > Game setup > the market > Gap-based entry. Enable it and choose
1?100 consecutive prediction losses (default 3). Save, then start manually.
Use the Bet9ja demo account explicitly: this mode does not detect or enforce demo.

Initial configuration seeds the gap sample from available completed history but
does not replay historical triggers. Occurrences use the Loss levels reached
definition: the draw reaching exactly the chosen loss threshold. The initial
left-censored streak is excluded until a WIN establishes its beginning.

At each new occurrence, compare the draw-ID gap since the previous occurrence
with the mean of prior completed gaps. At least two prior gaps are required;
retain up to the latest 100 gaps within continuous history. Freeze the decision
before adding the new gap to that sample. Qualify only when the new gap is at
least that average. A short-gap occurrence cannot become eligible later in the
same losing streak simply by waiting. SKIPs preserve loss counts and are included
in draw-ID gap distances. Qualified triggers wait for the next eligible prediction, still subject to sniper, summary, stake,
clock, balance, circuit-breaker and other existing execution gates. A WIN before
entry invalidates that ready trigger and starts a new sequence.

The trigger is consumed when execution is claimed by the extension. Consumption
is saved synchronously before the payload is returned. Retries of that existing
execution use the normal execution-token and receipt controls. A failed/uncertain
execution consumes the trigger too: it cannot roll into a different draw. Wait
for the reserved draw result and existing actual-bet settlement, and require an
observed prediction WIN before a fresh loss sequence can trigger again.

Stopping does not erase consumption. State is included in session_state.json and
restored on startup. Missing state blocks entry. Re-enabling unchanged settings
preserves consumed state, discards disabled-period triggers and waits for a fresh
WIN. Threshold changes initialize a new observation boundary while stopped.
An explicit session reset also starts a new observation boundary.

## Limits and semantics

Per-market, website-controlled individual mode only. No Unified, shadow,
rollover or automatic-suggestion combination. Applying suggestions is rejected
until gap entry is disabled. Existing manual settings saving already replaces
suggestions. Stake sizing is unchanged: select flat betting separately if wanted.

Missing draw IDs reset observation to waiting for a fresh WIN. Pending/unknown
results stop observation; entry requires the immediately preceding draw result.
Contradictory observed results within the latest 200 draw IDs pause the market
for review and an explicit stopped-session reset. Older corrected results are
not audited by this bounded state tracker. A missing reserved result blocks
further gap entries; it is not assumed lost, won or unplaced.

Both a new loss-level occurrence and a sufficiently long gap are required. The
dashboard displays the frozen decision average, sample count and measured gap.
The history page may display a different average because its selected range and
loaded records differ and it includes the latest completed gap. No threshold is
chosen automatically. Historical frequencies confer no predictive advantage by
themselves.

## Files and validation

- automation-gap-entry.js: configuration, observation, trigger claims and status.
- automation-control.js: authenticated website settings and compatibility checks.
- bot.js: entry/claim gates, persistence/restore/reset and decision messages.
- web/src/pages/AutomationPage.jsx: optional controls and current trigger status.

Node syntax checks and frontend production build passed. No automated execution,
restart or browser tests were run. No extension account was operated. The release includes a separate production bot branch patch; updating the website
alone does not install the server-side feature.
