'use strict';
// Synthetic fixtures verify recovery mechanics only; they are not reported performance.
const test = require('node:test');
const assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
const mm = require('./betzero-minmax');
const transitions = require('./betzero-statistics-transition');
const {createBetZeroLab} = require('./betzero-lab');
const SINGLE = 'simple_smallest_number_add_10';
const a = [3,8,17,23,36,44], b = [4,10,18,24,35,40], c = [7,12,19,25,32,38];
const record = (id,balls=a) => ({drawId:String(id), result:{balls}, settledAt:new Date(id*1000+100).toISOString()});
function setup(t) {
    const db=new DatabaseSync(':memory:');let time=1;
    const lab=createBetZeroLab(db,{now:()=>time});
    t.after(()=>db.close());
    lab.setStrategyEnabled(mm.ID,true);
    return {db,lab,setTime(value){time=value;},state:(version='1.0.0')=>lab.statsForVersion(mm.ID,version).decisionState,
        rows:(id=mm.ID)=>lab.listForwardPredictions({strategyId:id}),row:(target,id=mm.ID)=>lab.listForwardPredictions({strategyId:id}).find(x=>x.targetDrawId===String(target))};
}
function ingest(s,target,records,extra={}) {
    s.lab.ingestSnapshot({current:{drawId:String(target)},clock:{drawId:String(target),timeLeftSeconds:60,observedAt:target*1000},snapshotAt:target*1000,historyUpdates:records,...extra});
}
// Draws 1-6 give MIN as the starting method; the MIN/MAX prediction for draw 7 is [2,3,4].
function openPrediction(s) {
    ingest(s,7,Array.from({length:6},(_,i)=>record(i+1,i===5?b:a)));
    assert.equal(s.row(7).status,'PENDING');assert.deepEqual(s.row(7).selections,[3,4,5]);assert.equal(s.state().pending,7);
}

test('a result missing from the history feed is settled from the archive results and predictions continue',t=>{
    const s=setup(t);openPrediction(s);
    // Daily reset: draw 7 never appears in historyUpdates; only the archive results carry it.
    ingest(s,8,[],{labResults:[{drawId:7,balls:c}]});
    assert.equal(s.row(7).status,'WIN');assert.deepEqual(s.row(7).actualBalls,c);
    assert.equal(s.row(7,SINGLE).status,'WIN');
    const next=s.row(8);
    assert.equal(next.status,'PENDING');assert.equal(next.conditions.method,'MAX');assert.deepEqual(next.selections,[37,38,39]);
    assert.equal(next.conditions.timing.sourceVia,'ARCHIVE_RESULT');
    assert.deepEqual(s.row(8,SINGLE).selections,[17]);
    assert.equal(s.state().pending,8);
    // Repeating the same snapshot content changes nothing and never revises a settled row.
    const before=JSON.stringify(s.lab.listForwardPredictions());
    ingest(s,8,[],{labResults:[{drawId:7,balls:c}]});
    ingest(s,8,[],{labResults:[{drawId:7,balls:[...c].reverse()}]});
    assert.equal(JSON.stringify(s.lab.listForwardPredictions()),before);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM betzero_lab_result_revisions').get().n,0);
    assert.ok(!s.state().paused);
});

test('archive results never predict a draw that already has a result, and malformed entries are ignored',t=>{
    const s=setup(t);openPrediction(s);
    ingest(s,8,[],{labResults:[{drawId:7,balls:c},{drawId:8,balls:a}]});
    assert.equal(s.row(8),undefined);
    ingest(s,9,[],{labResults:[{drawId:8,balls:[1,1,2,3,4,5]},{drawId:'x',balls:a},null,{drawId:8.5,balls:a}]});
    assert.equal(s.row(9),undefined);
    // Two different results for one draw inside a single feed are both discarded.
    ingest(s,11,[],{labResults:[{drawId:10,balls:a},{drawId:10,balls:b}]});
    assert.equal(s.row(11),undefined);assert.ok(!s.state().paused);
});

test('a prediction whose result never arrives stops blocking after the overdue window',t=>{
    const s=setup(t);openPrediction(s);
    ingest(s,9,[record(8,c)]);
    assert.equal(s.row(9).conditions.reason,'UNRESOLVED_PREDICTION');assert.equal(s.state().pending,7);
    const recent=[1994,1995,1996,1997,1998].map(id=>({drawId:id,balls:a})).concat({drawId:1999,balls:b});
    ingest(s,2000,[record(1999,b)],{labResults:recent});
    const state=s.state();
    assert.equal(state.released.targetDrawId,7);assert.equal(state.released.reason,'RESULT_NOT_RECEIVED');
    assert.equal(s.row(2000).status,'PENDING');assert.equal(s.row(2000).conditions.method,'MIN');
    assert.equal(s.row(7).status,'PENDING'); // history is preserved for manual reconciliation
    // The abandoned row no longer blocks a cutover; the active one still does.
    assert.throws(()=>s.lab.cutoverMinmax({fromVersion:'1.0.0',toVersion:'2.0.0',confirmed:true}),/blocked: v1 is still waiting for the result of draw 2000/);
    // Switching v1 off stops new predictions, so the open one settles and the cutover is clear.
    s.lab.setStrategyEnabled(mm.ID,false);
    ingest(s,2001,[record(2000,c)]);
    assert.equal(s.row(2000).status,'WIN');assert.equal(s.row(2001).status,'SKIP');
    s.setTime(2001500);
    assert.equal(s.lab.cutoverMinmax({fromVersion:'1.0.0',toVersion:'2.0.0',confirmed:true}).toVersion,'2.0.0');
});

test('review resolution resumes a paused strategy and repeated conflicting feeds do not pause it again',t=>{
    const s=setup(t);openPrediction(s);
    ingest(s,8,[record(7,c)]);
    ingest(s,9,[record(7,a),record(8,b)]);
    assert.equal(s.state().paused,true);assert.equal(s.state().conflictDrawId,7);
    assert.throws(()=>s.lab.resolveMinmaxReview({}),/confirmation/);
    assert.throws(()=>s.lab.cutoverMinmax({fromVersion:'1.0.0',toVersion:'2.0.0',confirmed:true}),/blocked: v1 is paused/);
    const settled=JSON.stringify(s.row(7));
    assert.equal(s.lab.resolveMinmaxReview({confirmed:true}).resolved.length,2);
    assert.throws(()=>s.lab.resolveMinmaxReview({confirmed:true}),/nothing to resolve/);
    assert.ok(!s.state().paused);assert.equal(s.state().pending,null);
    ingest(s,10,[record(7,a),record(9,c)],{labResults:[{drawId:7,balls:a}]});
    assert.ok(!s.state().paused);assert.ok(!s.state('2.0.0').paused);
    assert.equal(JSON.stringify(s.row(7)),settled);
    assert.equal(s.db.prepare('SELECT conflicted FROM betzero_lab_minmax_draws WHERE draw_id=7').get().conflicted,1);
    assert.notEqual(s.row(10).conditions.reason,'RESULT_CONFLICT_REVIEW_REQUIRED');
});

test('streak-1 v3 predicts from the latest statistics alone and drops a number once its streak is 2',t=>{
    const s=setup(t);
    const sample=(source,values={})=>({btc:11090,period:'100',sourceDrawId:source,targetDrawId:source+1,
        requestedAt:source*1000+100,receivedAt:source*1000+110,deadline:(source+1)*1000,
        response:{data:{stats:Array.from({length:49},(_,i)=>({sel:String(i+1),strk:String(values[i+1] ?? 0)}))}}});
    const zero={id:transitions.ZERO,version:'3.0.0'},hit={id:transitions.HIT,version:'3.0.0'};
    const first=transitions.normalize(sample(10,{5:1,9:1,20:1,31:2}));
    assert.deepEqual(transitions.pick(zero,null,first,11).selections,[5,9,20]);
    const one=transitions.pick(hit,null,first,11);
    assert.equal(one.selections.length,1);assert.ok([5,9,20].includes(one.selections[0]));
    assert.deepEqual(transitions.pick(hit,null,first,11),one);
    // 9 moved to streak 2 and is removed; more than four qualifiers are capped at the first four.
    assert.deepEqual(transitions.pick(zero,null,transitions.normalize(sample(11,{5:1,9:2,20:1})),12).selections,[5,20]);
    assert.deepEqual(transitions.pick(zero,null,transitions.normalize(sample(11,{1:1,2:1,3:1,4:1,5:1})),12).selections,[1,2,3,4]);
    assert.equal(transitions.pick(zero,null,transitions.normalize(sample(11,{9:2})),12).conditions.reason,'NO_NUMBER_WITH_STREAK_ONE');
    assert.equal(transitions.pick(zero,null,first,12).conditions.reason,'MISSING_LATEST_STATISTICS');
    // Live: once switched on, one sample is enough and a two-number BetZero pick is graded.
    assert.equal(s.lab.strategies().filter(x=>x.version==='3.0.0').length,2);
    s.lab.setStrategyConfig(transitions.ZERO,{version:'3.0.0',enabled:true});
    const rows=target=>s.lab.listForwardPredictions({strategyId:transitions.ZERO,strategyVersion:'3.0.0'}).find(x=>x.targetDrawId===String(target));
    s.setTime(10200);
    s.lab.ingestSnapshot({current:{drawId:'11'},clock:{drawId:'11',timeLeftSeconds:60,observedAt:10200},snapshotAt:10200,historyUpdates:[record(10,a)],numberStatistics:sample(10,{5:1,9:1})});
    assert.equal(rows(11).status,'PENDING');assert.deepEqual(rows(11).selections,[5,9]);
    s.setTime(11200);
    s.lab.ingestSnapshot({current:{drawId:'12'},clock:{drawId:'12',timeLeftSeconds:60,observedAt:11200},snapshotAt:11200,historyUpdates:[record(11,b)],numberStatistics:sample(11,{5:1,9:2})});
    assert.equal(rows(11).status,'WIN');assert.deepEqual(rows(12).selections,[5]);
});

test('resetting one strategy history archives its rows, clears its totals and lets predictions continue',t=>{
    const s=setup(t);openPrediction(s);
    ingest(s,8,[record(7,c)]);
    assert.equal(s.row(7).status,'WIN');assert.equal(s.row(8).status,'PENDING');
    assert.equal(s.lab.statsForVersion(mm.ID,'1.0.0').wins,1);
    const single=JSON.stringify(s.rows(SINGLE));
    assert.throws(()=>s.lab.resetStrategyHistory({strategyId:mm.ID,version:'1.0.0'}),/confirmation/);
    assert.throws(()=>s.lab.resetStrategyHistory({strategyId:'nope',version:'1.0.0',confirmed:true}),/Unknown lab strategy/);
    s.setTime(8500);
    const result=s.lab.resetStrategyHistory({strategyId:mm.ID,version:'1.0.0',confirmed:true});
    assert.equal(result.archived,2);assert.equal(result.resetAt,8500);
    assert.deepEqual(s.rows(),[]);
    const stats=s.lab.statsForVersion(mm.ID,'1.0.0');
    assert.equal(stats.wins,0);assert.equal(stats.losses,0);assert.equal(stats.last100.length,0);assert.equal(stats.historyResetAt,8500);
    assert.equal(stats.decisionState.pending,null);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM betzero_lab_streak_events WHERE strategy_id=?').get(mm.ID).n,0);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM betzero_lab_forward_predictions_archive WHERE strategy_id=? AND reset_at=8500').get(mm.ID).n,2);
    // Other strategies keep their history, and the reset strategy predicts again on the next draw.
    assert.equal(JSON.stringify(s.rows(SINGLE)),single);
    ingest(s,9,[record(8,a)]);
    assert.equal(s.row(9).status,'PENDING');assert.equal(s.rows().length,1);
    assert.equal(s.row(8,SINGLE).status,'LOSS');
});

test('every lab admin action is reachable on the public website',()=>{
    // In public mode the server answers 404 for any route missing from PUBLIC_SITE_ROUTES.
    const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'bot.js'),'utf8');
    const allowed=source.slice(source.indexOf('const PUBLIC_SITE_ROUTES'),source.indexOf('function isAllowedApiOrigin'));
    const handled=[...new Set([...source.matchAll(/pathname === '(\/admin\/betzero-lab\/[a-z-]+)'/g)].map(match=>match[1]))];
    assert.ok(handled.includes('/admin/betzero-lab/reset-history'));
    for (const route of handled) assert.ok(allowed.includes(`'POST ${route}'`) || allowed.includes(`'GET ${route}'`),`${route} is not allowed in public mode`);
});

test('statistics samples without a provider status are accepted and rejections are explained',t=>{
    const s=setup(t);
    const sample=(source,values={},rows=49)=>({btc:11090,period:'100',sourceDrawId:source,targetDrawId:source+1,
        requestedAt:source*1000+100,receivedAt:source*1000+110,deadline:(source+1)*1000,
        response:{data:{stats:Array.from({length:rows},(_,i)=>({sel:String(i+1),strk:String(values[i+1] ?? 0)}))}}});
    assert.ok(transitions.normalize(sample(10)));
    assert.equal(transitions.inspect(sample(10,{},48)).reason,'ROW_COUNT_NOT_49');
    assert.equal(transitions.inspect({...sample(10),response:null}).reason,'NO_PROVIDER_RESPONSE');
    const send=(raw,at)=>{s.setTime(at);s.lab.ingestSnapshot({current:null,clock:{},historyUpdates:[],snapshotAt:at,numberStatistics:raw});};
    send(null,10050);
    assert.equal(s.lab.overview().numberStatistics.lastIngest.outcome,'NOT_PROVIDED');
    send(sample(10,{},48),10120);
    let last=s.lab.overview().numberStatistics.lastIngest;
    assert.equal(last.outcome,'REJECTED');assert.equal(last.reason,'ROW_COUNT_NOT_49');assert.equal(last.shape.rows,48);
    assert.deepEqual(last.shape.firstRowKeys,['sel','strk']);
    send(sample(10),10130);
    assert.equal(s.lab.overview().numberStatistics.snapshots,1);
    assert.equal(s.lab.overview().numberStatistics.lastIngest.outcome,'STORED');
    // The worker repeats the same sample every few seconds, even after the draw closes.
    send(sample(10),10140);send(sample(10),11500);
    last=s.lab.overview().numberStatistics.lastIngest;
    assert.equal(last.outcome,'STORED');assert.equal(last.sourceDrawId,10);assert.equal(last.at,10130);
    send(sample(10,{1:3}),10150);
    assert.equal(s.lab.overview().numberStatistics.lastIngest.outcome,'CONFLICT');
    assert.equal(s.lab.overview().numberStatistics.conflicts,1);
});
test('the lab overview only offers the six current predictions',t=>{
    const s=setup(t);openPrediction(s);
    const overview=s.lab.overview();
    assert.deepEqual(Object.keys(overview.strategyVersions).sort(),['minimum_maximum_three@2.0.0','minmax_high_low@1.0.0','simple_smallest_number_add_10@1.0.0',
        'smallest_add10_step10_four@1.0.0','statistics_streak_drop_bet49@3.0.0','statistics_streak_drop_betzero@3.0.0']);
    assert.deepEqual(Object.keys(overview.forwardVersionWindows).map(key=>key.replace(':','@')).sort(),Object.keys(overview.strategyVersions).sort());
    // The retired MIN/MAX v1 made a prediction above; its records stay stored but are not listed.
    assert.equal(s.rows().length,1);
    assert.ok(overview.predictions.length>0);
    assert.ok(overview.predictions.every(row=>`${row.strategyId}@${row.strategyVersion}` in overview.strategyVersions));
    assert.ok(s.lab.listForwardPredictions().every(row=>`${row.strategyId}@${row.strategyVersion}` in overview.strategyVersions));
});
