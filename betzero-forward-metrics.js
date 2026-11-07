'use strict';
const { probabilityAllAbsent, seededRandom, randomSelections, wilsonInterval, validSelections, validBalls } = require('./betzero-lab');
const SEED = 'betzero-forward-baseline-v1';
const cache = new WeakMap();

function forwardWindows(db, strategies, now = Date.now(), versioned = false) {
    let saved = cache.get(db); if (!saved) { saved = new Map(); cache.set(db, saved); }
    return Object.fromEntries(strategies.filter(s => s.selectionCount > 0 && (versioned || s.version === '1.0.0')).map(strategy => {
        const rows = db.prepare(`SELECT * FROM betzero_lab_forward_predictions WHERE strategy_id=? AND strategy_version=?
            AND status IN ('WIN','LOSS','SKIP','INVALID') ORDER BY CAST(target_draw_id AS INTEGER) DESC LIMIT 1000`).all(strategy.id,strategy.version).reverse();
        const pending = db.prepare("SELECT COUNT(*) AS n FROM betzero_lab_forward_predictions WHERE strategy_id=? AND strategy_version=? AND status='PENDING'").get(strategy.id,strategy.version).n;
        const quality = require('./betzero-reconciliation').pendingQuality(db, strategy.id, strategy.version, now);
        const key = `${strategy.id}:${strategy.version}`, signature = JSON.stringify([rows,pending,quality,strategy.config.alertThresholds]);
        if (saved.get(key)?.signature === signature) return [versioned ? key : strategy.id,saved.get(key).value];
        const measured = rows.map(row => {
            const timing=JSON.parse(row.conditions_json).timing;
            const predictedAt=Date.parse(row.predicted_at),validatedAt=Date.parse(row.validated_at);
            const verified=!!timing && Number.isFinite(predictedAt) && predictedAt===timing.recordedAt
                && timing.observedAt<=timing.snapshotAt && timing.snapshotAt<=predictedAt && predictedAt<timing.expectedTargetAt
                && Number(row.target_draw_id)===Number(row.source_draw_id)+1;
            const outcome=['WIN','LOSS'].includes(row.status), balls=JSON.parse(row.actual_balls_json || 'null');
            const usable=verified && (!outcome || (validatedAt>predictedAt && validBalls(balls) && validSelections(JSON.parse(row.selections_json),strategy.selectionCount)));
            let randomWins=0;
            if(usable && outcome) {
                const random=seededRandom(`${SEED}:${strategy.id}:${strategy.version}:${row.target_draw_id}`);
                if(randomSelections(strategy.selectionCount,random).every(x=>!balls.includes(x)))randomWins++;
            }
            return {targetDrawId:row.target_draw_id,status:row.status,usable,randomWins};
        });
        const windows=Object.fromEntries([100,500,1000].map(size=>{
            const selected=measured.slice(-size);
            let wins=0,losses=0,skipped=0,invalid=0,unverified=0,currentLoss=0,worstLoss=0,currentWin=0,longestWin=0,randomWins=0;
            const chart=[];
            for(const row of selected){
                if(!row.usable){unverified++;continue;}
                if(row.status==='SKIP'){skipped++;continue;}
                if(row.status==='INVALID'){invalid++;continue;}
                if(row.status==='WIN'){wins++;currentLoss=0;longestWin=Math.max(longestWin,++currentWin);}
                else{losses++;currentWin=0;worstLoss=Math.max(worstLoss,++currentLoss);}
                randomWins+=row.randomWins;chart.push({targetDrawId:row.targetDrawId,status:row.status});
            }
            const n=wins+losses,theoretical=probabilityAllAbsent(strategy.selectionCount);
            const threshold=Math.min(...(strategy.config.alertThresholds || [3,5,7,10]));
            return [size,{...quality,requested:size,available:selected.length,settled:n,wins,losses,skipped,invalid,unverified,pending,
                winRate:n?wins/n:null,confidenceInterval95:wilsonInterval(wins,n),currentLosingStreak:currentLoss,worstLosingStreak:worstLoss,longestWinningStreak:longestWin,
                theoreticalBaseline:theoretical,randomBaseline:{seed:SEED,repetitions:1,trials:n,wins:randomWins,winRate:n?randomWins/n:null},
                streakFlag:currentLoss>=threshold?'Loss-streak threshold reached. This is not a reversal signal.':null,chart}];
        }));
        const value={version:strategy.version,windows};saved.set(key,{signature,value});return [versioned ? key : strategy.id,value];
    }));
}
module.exports={forwardWindows};
