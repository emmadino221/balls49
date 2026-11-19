"""Remove retired prediction history, never raw draws or BetZero Lab research.
Default is read-only. Apply only with application services stopped.
"""
import argparse, datetime, json, pathlib, shutil, sqlite3
parser=argparse.ArgumentParser()
parser.add_argument('--directory',required=True)
parser.add_argument('--database',action='append',default=[])
parser.add_argument('--apply',action='store_true')
parser.add_argument('--services-stopped',action='store_true')
args=parser.parse_args()
root=pathlib.Path(args.directory).resolve(strict=True)
if args.apply and not args.services_stopped: raise SystemExit('Apply requires --services-stopped after stopping all application writers.')
retired={'totalColor2','unified'}
fields=retired|{'totalColor2Pred','unifiedPick','tc2Pred','tc2Step','tc2Result','umPred','umStep','umResult','umCurrentStreak','umMaxLoss'}
def clean(v):
    if isinstance(v,list):
        return [clean(x) for x in v if not (isinstance(x,str) and x in retired) and not (isinstance(x,dict) and any(x.get(k) in retired for k in ('market','game','id','key') if isinstance(x.get(k),str)))]
    if not isinstance(v,dict): return v
    out={k:clean(x) for k,x in v.items() if k not in fields}
    if 'totalColor2Pred' in v and 'colorRanking' not in out: out['colorRanking']=v['totalColor2Pred']
    if 'unifiedMode' in out: out['unifiedMode']=False
    return out
names=['predictions.json','last_prediction.json','daily_pending_settlements.json','streaks.json','win_steps.json','session_state.json','site_users.json','telegram_prediction_outbox.json']
files=[]
for name in names:
    p=root/name
    if not p.exists(): continue
    raw=p.read_text(encoding='utf-8-sig'); obj=json.loads(raw)
    if name=='session_state.json':
        for session in obj.get('sessions',{}).values():
            if session.get('lastBetDetails') or session.get('betExecutionClaim') or session.get('stats',{}).get('isHalted') is False:
                raise SystemExit('Stop automation and settle outstanding bets before purging session history.')
    updated=clean(obj)
    if name=='telegram_prediction_outbox.json' and isinstance(updated,list):
        updated=[x for x in updated if not any(word in json.dumps(x).lower() for word in ['2-way','2w','unified'])]
    # Shared ranking is still needed to settle remaining markets after restart.
    if name=='last_prediction.json' and isinstance(obj,dict):
        for source,dest in [(obj,updated),(obj.get('pred',{}),updated.get('pred',{}))]:
            if isinstance(source,dict) and 'totalColor2Pred' in source: dest['colorRanking']=source['totalColor2Pred']
    if obj!=updated:files.append((p,json.dumps(updated,ensure_ascii=False,indent=2)))
# Fixed allowlist; deliberately exclude sealed Lab protocols, job hashes and raw collector tables.
tables={'public_prediction_history':('draw_id',['record_json']),
        'public_prediction_feed':('id',['current_json','history_json']),
        'daily_streak_archive':('day',['summary_json','outcomes_json']),
        'site_users':('email',['user_json'])}
databases=[]
for name in args.database or [str(root/'site_users.sqlite')]:
    p=pathlib.Path(name).resolve()
    if not p.exists():continue
    db=sqlite3.connect(p.as_uri()+'?mode=ro',uri=True)
    present={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    edits=[]
    for table,(key,cols) in tables.items():
        if table not in present:continue
        actual={r[1] for r in db.execute('PRAGMA table_info("'+table+'")')}
        if not {key,*cols}<=actual:raise SystemExit('Unexpected schema in '+table)
        for row in db.execute('SELECT "'+key+'",'+','.join('"'+c+'"' for c in cols)+' FROM "'+table+'"'):
            for col,raw in zip(cols,row[1:]):
                if raw is None:continue
                old=json.loads(raw); new=clean(old)
                if old!=new:edits.append((table,key,row[0],col,raw,json.dumps(new,separators=(',',':'))))
    if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise SystemExit('Database integrity check failed.')
    db.close();databases.append((p,edits))
print('JSON files requiring cleanup:',len(files))
for p,edits in databases:print(p.name,'JSON cells requiring cleanup:',len(edits))
if not args.apply:print('Dry-run only; no records changed.');raise SystemExit(0)
backup=root/'retirement-backups'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
backup.mkdir(parents=True,exist_ok=False)
for p,_ in files:shutil.copy2(p,backup/p.name)
for index,(p,_) in enumerate(databases):
    with sqlite3.connect(p) as src,sqlite3.connect(backup/(str(index)+'-'+p.name)) as dest:
        src.backup(dest)
        if dest.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise SystemExit('Backup integrity failed.')
# Each DB is transactional. Recovery files cover a failure between databases/JSON files.
for p,edits in databases:
    db=sqlite3.connect(p);db.execute('PRAGMA busy_timeout=5000');db.execute('PRAGMA secure_delete=ON')
    try:
        db.execute('BEGIN IMMEDIATE')
        for table,key,identity,col,old,new in edits:
            cursor=db.execute('UPDATE "'+table+'" SET "'+col+'"=? WHERE "'+key+'"=? AND "'+col+'"=?',(new,identity,old))
            if cursor.rowcount!=1:raise RuntimeError('Data changed after inspection; stop all writers.')
        if db.execute('PRAGMA foreign_key_check').fetchone():raise RuntimeError('Foreign key check failed')
        if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise RuntimeError('Integrity check failed')
        db.commit();db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    except:db.rollback();raise
    finally:db.close()
for p,content in files:
    temporary=p.with_suffix(p.suffix+'.retirement-tmp');temporary.write_text(content,encoding='utf-8');temporary.replace(p)
print('Retired fields removed from active stores. Recovery backup:',backup)
print('Backups and previously delivered Telegram messages are not erased by this tool.')
