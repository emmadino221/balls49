'use strict';
async function handleCutoverApi({req,res,session,lab,readJson,sendJson}) {
    if (!session?.admin) return sendJson(res,401,{error:'Admin sign-in required.'});
    if (req.method !== 'POST') return sendJson(res,405,{error:'POST required.'});
    if (!lab) return sendJson(res,503,{error:'Lab storage unavailable.'});
    let input;
    try { input=await readJson(req); } catch { return sendJson(res,400,{error:'Invalid cutover request.'}); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return sendJson(res,400,{error:'Invalid cutover request.'});
    try { return sendJson(res,200,{cutover:lab.cutoverMinmax(input)}); }
    catch(error) { return sendJson(res,error.status || (/locked|busy/i.test(error.message)?503:500),{
        error:error.status ? error.message : 'Cutover did not complete. Refresh the lab before retrying.'
    }); }
}
module.exports={handleCutoverApi};
