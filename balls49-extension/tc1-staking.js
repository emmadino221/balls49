(function (root) {
    'use strict';
    const ODDS = 3.8;
    function mode(value) { return value === 'accumulating' ? value : 'fixed'; }
    function nextStake(base, losses, bets, profitMode = 'fixed') {
        if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(losses) || losses < 0
            || !Number.isSafeInteger(bets) || bets < 0) return 0;
        base = Math.ceil(base);
        const target = base * 2.8 * (mode(profitMode) === 'accumulating' ? bets + 1 : 1);
        const stake = bets === 0 && losses === 0 ? Math.ceil(base) : Math.ceil((losses + target) / 2.8 - 1e-9);
        return Number.isSafeInteger(stake) && stake > 0 ? stake : 0;
    }
    function stakeAtStep(base, step, profitMode = 'fixed') {
        if (!Number.isSafeInteger(step) || step < 1 || step > 1000) return 0;
        let losses = 0, stake = 0;
        for (let bet = 0; bet < step; bet++) {
            stake = nextStake(base, losses, bet, profitMode);
            if (!stake) return 0;
            losses += stake;
        }
        return stake;
    }
    const api = { ODDS, mode, nextStake, stakeAtStep };
    // Website pages import this file for its browser API. Bundlers can supply a
    // CommonJS module too, so exporting must not skip the global registration.
    root.TC1Staking = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
