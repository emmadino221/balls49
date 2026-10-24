'use strict';

// Nigeria stays at UTC+1 year-round: midnight is 23:00 UTC on the previous day.
function nigeriaMidnightBoundary(now = Date.now()) {
    const date = new Date(now);
    const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23);
    return now >= midnight ? midnight : midnight - 86400000;
}

module.exports = { nigeriaMidnightBoundary };
