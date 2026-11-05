#!/usr/bin/env node
'use strict';
// Explicit operator command only. Not imported by the web server, bot or worker.
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { planReconciliation } = require('../betzero-reconciliation');
function main(args) {
    const values = {}; let apply = false;
    for (let i=0;i<args.length;i++) {
        const key=args[i];
        if (key==='--apply') { apply=true; continue; }
        if (key==='--dry-run') continue;
        if (!['--db','--archive','--target'].includes(key) || !args[i+1] || args[i+1].startsWith('--')) throw new Error('Use --db PATH --archive PATH [--target ID] [--dry-run | --apply].');
        values[key]=args[++i];
    }
    if (args.includes('--apply') && args.includes('--dry-run')) throw new Error('Choose dry-run OR apply.');
    if (!values['--db'] || !values['--archive']) throw new Error('Existing database and collector archive paths are required.');
    if (!fs.statSync(values['--db']).isFile()) throw new Error('Database file is required.');
    const archive=JSON.parse(fs.readFileSync(values['--archive'],'utf8'));
    const db=new DatabaseSync(values['--db'], { readOnly: !apply });
    try {
        db.exec('PRAGMA busy_timeout=1000');
        const settings={target:values['--target'],source:values['--archive'],dryRun:!apply};
        const result=apply ? require('../betzero-lab').createBetZeroLab(db).reconcileArchive(archive,settings) : planReconciliation(db,archive,settings);
        // Do not print selections, source balls or private database records.
        const decisions=result.decisions.map(({original,balls,...safe})=>safe);
        console.log(JSON.stringify({...result,decisions},null,2));
    } finally { db.close(); }
}
if (require.main===module) { try { main(process.argv.slice(2)); } catch(error) { console.error(error.message); process.exitCode=1; } }
module.exports={main};
