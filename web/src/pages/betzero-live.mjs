export const CLOCK_STALE_MS = 30000;
export const REFRESH_MS = 10000;

// HTTP Date anchors the collector timestamp to server time, not the device clock.
// Date has one-second precision; the upper bound plus RTT deliberately expires early.
export function acceptClock(payload, { date, started, received, wall }, previous = null) {
  const serverDate = Date.parse(date || '');
  const id = String(payload?.drawId || '');
  const seconds = payload?.timeLeftSeconds;
  const observed = payload?.observedAt;
  const rtt = received - started;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))
      || !Number.isFinite(seconds) || seconds < 0 || seconds > 300
      || !Number.isSafeInteger(observed) || observed <= 0 || !Number.isFinite(serverDate)
      || rtt < 0 || rtt > 5000) throw new Error('Clock response is incomplete or too delayed to trust.');
  const serverUpper = serverDate + 1000 + rtt;
  if (observed > serverUpper + 1000 || serverUpper - observed > CLOCK_STALE_MS)
    throw new Error('The server clock observation is stale or inconsistent.');
  const deadline = observed + seconds * 1000;
  if (previous && (Number(id) < Number(previous.drawId) || observed < previous.observedAt
      || (observed === previous.observedAt && (id !== previous.drawId || deadline !== previous.deadline))
      || (id === previous.drawId && Math.abs(deadline - previous.deadline) > 5000)))
    throw new Error('The draw clock moved backwards or changed inconsistently.');
  return { drawId:id, observedAt:observed, deadline, serverUpper, received, wall };
}

export function clockView(clock, mono, wall, failed = false) {
  if (!clock) return { status:'UNAVAILABLE', seconds:null, reliable:false };
  const elapsed = mono - clock.received;
  if (failed || elapsed < 0 || Math.abs((wall - clock.wall) - elapsed) > 2000
      || clock.serverUpper + elapsed - clock.observedAt >= CLOCK_STALE_MS)
    return { status:'STALE', seconds:null, reliable:false };
  const seconds = Math.max(0, Math.floor((clock.deadline - clock.serverUpper - elapsed) / 1000));
  return seconds > 0 ? { status:'LIVE', seconds, reliable:true }
    : { status:'UPDATING', seconds:null, reliable:false };
}

// One request cycle, one timeout, no overlapping focus/manual/periodic refreshes.
export function createRefreshLoop({ run, visible = () => true, onError = () => {},
  setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now }) {
  let timer, active = null, disposed = false, expired = false, failures = 0, lastStarted = -Infinity;
  const schedule = delay => {
    clearTimer(timer);
    if (!disposed && !expired && visible()) timer = setTimer(() => refresh(), delay);
  };
  async function refresh() {
    if (disposed || expired || !visible() || active) return;
    if (now() - lastStarted < 1000) { schedule(1000); return; }
    clearTimer(timer);
    lastStarted = now();
    const controller = new AbortController();
    active = controller;
    const timeout = setTimer(() => controller.abort(), 15000);
    try { await run(controller.signal); if (!controller.signal.aborted) failures = 0; }
    catch (error) {
      if (!disposed && visible()) {
        failures++;
        expired = [401,403].includes(error.status);
        onError(error, expired);
      }
    } finally {
      clearTimer(timeout);
      if (active === controller) active = null;
      schedule(Math.min(120000, REFRESH_MS * 2 ** Math.min(failures,4)));
    }
  }
  return {
    refresh,
    visibility() { if (!visible()) { clearTimer(timer); active?.abort(); } else refresh(); },
    dispose() { disposed = true; clearTimer(timer); active?.abort(); }
  };
}
