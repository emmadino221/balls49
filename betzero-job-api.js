'use strict';
async function handleJobApi({ req, res, url, session, store, lab, readJson, sendJson }) {
    if (!['/admin/betzero-lab/jobs','/admin/betzero-lab/job-cancel','/admin/betzero-lab/protocols'].includes(url.pathname)) return false;
    if (!session?.admin) { sendJson(res,401,{ error:'Admin sign-in required.' }); return true; }
    if (!store || !lab) { sendJson(res,503,{ error:'Lab queue unavailable.' }); return true; }
    try {
        if (req.method === 'GET' && url.pathname.endsWith('/jobs')) {
            const id = url.searchParams.get('id');
            const value = id ? store.get(id) : { jobs:store.list() };
            sendJson(res,value ? 200 : 404,value || { error:'Job not found.' });
        } else if (req.method === 'GET' && url.pathname.endsWith('/protocols')) sendJson(res,200,{ protocols:store.protocols() });
        else if (req.method === 'POST') {
            const input = await readJson(req);
            if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('Invalid lab request.'),{status:400});
            if (url.pathname.endsWith('/jobs')) sendJson(res,202,store.enqueue(input,lab.strategies()));
            else if (url.pathname.endsWith('/job-cancel')) sendJson(res,200,store.cancel(String(input.id || '')));
            else sendJson(res,201,store.seal(input,lab.strategies()));
        } else sendJson(res,405,{ error:'Method not allowed.' });
    } catch (error) {
        const busy = /locked|busy/i.test(error.message);
        sendJson(res,error.status || (busy ? 503 : 500),{ error:error.status ? error.message : busy ? 'Lab database is busy; retry shortly.' : 'Lab request failed.' });
    }
    return true;
}
function smallBacktestRecords(records, window, strategyId = null) {
    const requested = String(window || 'all');
    if (!['100','500','1000','all'].includes(requested)) throw Object.assign(new Error('Unsupported window.'),{status:400});
    // The production log is already newest-first. Slice before any lab normalization/sort.
    if (requested !== '100' && records.length > 101) throw Object.assign(new Error('Use POST /admin/betzero-lab/jobs for more than 100 source/target pairs.'),{status:413});
    if (strategyId === 'minimum_maximum_three') {
        const {normalizeHistoricalDraws,makeOpportunities} = require('./betzero-lab');
        const pairs = makeOpportunities(normalizeHistoricalDraws(records).draws).opportunities;
        const context = pairs.slice(-105);
        if (!context.length) return [];
        return records.filter(r => Number(r.drawId) >= context[0].source.id);
    }
    return records.slice(0,101);
}
module.exports = { handleJobApi, smallBacktestRecords };
