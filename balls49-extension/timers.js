// Chrome slows setTimeout in hidden or covered tabs (down to once a minute).
// Each timer here is also run by the extension's background worker, which is
// not slowed; whichever fires first runs the callback exactly once, so a
// timer never fires early and never fires twice.
(() => {
    const nativeSet = window.setTimeout.bind(window);
    const nativeClear = window.clearTimeout.bind(window);
    const ID_BASE = 1e9;            // keeps these ids apart from native timer ids
    const MAX_WORKER_MS = 20000;    // the worker may be unloaded after 30s idle
    const pending = new Map();
    let nextId = ID_BASE;
    let port = null;
    let lastConnectAt = 0;

    function fire(id) {
        const timer = pending.get(id);
        if (!timer) return;
        pending.delete(id);
        nativeClear(timer.native);
        timer.fn(...timer.args);
    }

    function post(id, ms) {
        if (!port || ms > MAX_WORKER_MS) return;
        try { port.postMessage({ id, ms }); } catch (e) { port = null; }
    }

    function connect() {
        lastConnectAt = Date.now();
        try {
            port = chrome.runtime.connect({ name: 'balls49-timers' });
            port.onMessage.addListener(message => fire(message.id));
            port.onDisconnect.addListener(() => {
                void chrome.runtime.lastError;
                port = null;
                // The worker was unloaded: wake it and hand back the waiting
                // timers. The native timers stay armed as a fallback.
                if (Date.now() - lastConnectAt < 1000 || !connect()) return;
                for (const [id, timer] of pending) post(id, Math.max(0, timer.due - Date.now()));
            });
            return true;
        } catch (e) {
            // Extension was reloaded or removed: native timers still work.
            port = null;
            return false;
        }
    }

    window.setTimeout = (fn, ms, ...args) => {
        if (typeof fn !== 'function') return nativeSet(fn, ms, ...args);
        const delay = Math.max(0, Number(ms) || 0);
        const id = nextId++;
        pending.set(id, { fn, args, due: Date.now() + delay, native: nativeSet(() => fire(id), delay) });
        if (!port && Date.now() - lastConnectAt >= 1000) connect();
        post(id, delay);
        return id;
    };

    window.clearTimeout = id => {
        const timer = pending.get(id);
        if (!timer) return nativeClear(id);
        pending.delete(id);
        nativeClear(timer.native);
    };
})();
