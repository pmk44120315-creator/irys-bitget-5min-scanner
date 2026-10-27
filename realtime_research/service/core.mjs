/** Read-only venue-local evidence. No orders, alerts, ownership or price predictions. */
const MINUTE=60000;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const num=x=>{if(typeof x!=='number'&&(typeof x!=='string'||!x.trim()))return null;const v=Number(x);return finite(v)?v:null;};
export function parseFrame(raw, receivedMs) {
  try {
    // JSON numbers above 2^53 lose bits. Preserve the exchange's trade ID first.
    const o=typeof raw==='string'?JSON.parse(raw.replace(/("sequential_id"\s*:\s*)(\d+)/g,'$1"$2"')):raw;
    if(!o||!/^KRW-[A-Z0-9]+$/.test(o.code||'')||o.stream_type==='SNAPSHOT')return null;
    let ts=num(o.type==='trade'?(o.trade_timestamp??o.timestamp):o.timestamp);
    if(ts===null||!Number.isSafeInteger(ts))return null;
    const unit=ts>=1e15?'microseconds':'milliseconds';
    if(unit==='microseconds')ts=Math.floor(ts/1000);
    if(ts<1e12||Math.abs(ts-receivedMs)>60000)return null;
    const p={market:o.code,ts,received:receivedMs,unit,type:o.type};
    if(o.type==='trade') {
      const price=num(o.trade_price),qty=num(o.trade_volume);
      if(price===null||qty===null||price<=0||qty<=0||!['BID','ASK'].includes(o.ask_bid)||o.sequential_id===undefined)return null;
      if(typeof o.sequential_id==='number'&&!Number.isSafeInteger(o.sequential_id))return null;
      const id=String(o.sequential_id);if(!/^\d+$/.test(id))return null;
      return {...p,id,side:o.ask_bid,price,qty,key:JSON.stringify([p.market,id,ts,o.ask_bid,price,qty])};
    }
    if(o.type!=='orderbook'||!Array.isArray(o.orderbook_units)||!o.orderbook_units.length)return null;
    if(o.level!==undefined&&num(o.level)!==1)return null; // grouped levels are not exact execution prices
    const bids=[],asks=[];
    for(const u of o.orderbook_units){
      const bp=num(u.bid_price),ap=num(u.ask_price),bq=num(u.bid_size),aq=num(u.ask_size);
      if([bp,ap,bq,aq].includes(null)||bp<=0||ap<=0||bq<0||aq<0)return null;
      if(bq>0)bids.push([bp,bq]);if(aq>0)asks.push([ap,aq]);
    }
    bids.sort((a,b)=>b[0]-a[0]);asks.sort((a,b)=>a[0]-b[0]);
    if(!bids.length||!asks.length||bids[0][0]>=asks[0][0])return null;
    if(new Set(bids.map(x=>x[0])).size!==bids.length||new Set(asks.map(x=>x[0])).size!==asks.length)return null;
    return {...p,bids,asks};
  } catch {return null;}
}
export class EvidenceStore {
  constructor(sql){
    this.sql=sql;this.books=new Map();this.sessions=new Map();
    for(const statement of [
      'CREATE TABLE IF NOT EXISTS rt_session (id TEXT PRIMARY KEY,market TEXT,start_ms INTEGER,last_ms INTEGER,end_ms INTEGER,reason TEXT)',
      'CREATE INDEX IF NOT EXISTS rt_session_market ON rt_session(market,start_ms)',
      'CREATE TABLE IF NOT EXISTS rt_trade (key TEXT PRIMARY KEY,market TEXT,ts INTEGER,received INTEGER,side TEXT,price REAL,qty REAL,raw_id TEXT)',
      'CREATE INDEX IF NOT EXISTS rt_trade_market ON rt_trade(market,ts)',
      'CREATE TABLE IF NOT EXISTS rt_book (market TEXT,sec INTEGER,ts INTEGER,received INTEGER,bids TEXT,asks TEXT,frames INTEGER,PRIMARY KEY(market,sec))',
      'CREATE TABLE IF NOT EXISTS rt_quality (market TEXT,ts INTEGER,until_ms INTEGER,reason TEXT)',
      'CREATE TABLE IF NOT EXISTS rt_reconcile (market TEXT,minute INTEGER,expected REAL,actual REAL,error REAL,status TEXT,checked INTEGER,PRIMARY KEY(market,minute))',
      'CREATE TABLE IF NOT EXISTS rt_absorption (market TEXT,ts INTEGER,price REAL,sold_qty REAL,net_replenishment REAL,PRIMARY KEY(market,ts,price))'
    ])this.rows(statement);
  }
  rows(q,...a){return this.sql.exec(q,...a).toArray();}
  start(market,now){
    if(!/^KRW-[A-Z0-9]+$/.test(market)||!Number.isSafeInteger(now))throw Error('INVALID_SESSION');
    this.rows('UPDATE rt_session SET end_ms=last_ms,reason=? WHERE market=? AND end_ms IS NULL','RESTART_OR_RECONNECT',market);
    const id=crypto.randomUUID();this.sessions.set(market,id);this.books.delete(market);
    this.rows('INSERT INTO rt_session VALUES (?,?,?,?,NULL,NULL)',id,market,now,now);return id;
  }
  stop(market,now,reason='DISCONNECTED'){
    this.rows('UPDATE rt_session SET end_ms=MIN(last_ms,?),reason=? WHERE market=? AND end_ms IS NULL',now,reason,market);
    this.sessions.delete(market);this.books.delete(market);
  }
  quality(market,ts,until,reason){this.rows('INSERT INTO rt_quality VALUES (?,?,?,?)',market,ts,Math.max(until,ts+1),reason);}
  ingest(raw,received){
    const p=parseFrame(raw,received);if(!p||!this.sessions.has(p.market))return false;
    const sid=this.sessions.get(p.market);
    this.rows('UPDATE rt_session SET last_ms=MAX(last_ms,?) WHERE id=?',received,sid);
    if(p.type==='trade'){
      this.rows('INSERT OR IGNORE INTO rt_trade VALUES (?,?,?,?,?,?,?,?)',p.key,p.market,p.ts,p.received,p.side,p.price,p.qty,p.id);
      if(!this.rows('SELECT changes() AS n')[0].n){this.quality(p.market,p.ts,p.ts+1,'AMBIGUOUS_DUPLICATE');return false;}
      this.rows('DELETE FROM rt_reconcile WHERE market=? AND minute=?',p.market,Math.floor(p.ts/MINUTE)*MINUTE);
      return true;
    }
    const prev=this.books.get(p.market);
    if(prev){
      if(p.ts<=prev.ts){this.quality(p.market,p.ts,prev.ts+1,'BOOK_OUT_OF_ORDER');return false;}
      if(p.received-prev.received>2000||p.ts-prev.ts>2000){this.quality(p.market,prev.ts,p.ts,'BOOK_GAP');}
      else {
        // Only executed sells at this exact price between these frames count.
        // Net replenishment is an estimate; cancellations/hidden orders remain unknown.
        const old=new Map(prev.bids),cur=new Map(p.bids);
        const fills=this.rows('SELECT price,SUM(qty) AS qty FROM rt_trade WHERE market=? AND side=? AND ts>? AND ts<=? GROUP BY price',p.market,'ASK',prev.ts,p.ts);
        for(const f of fills){if(!old.has(f.price)||!cur.has(f.price))continue;
          const refill=cur.get(f.price)-old.get(f.price)+f.qty;
          if(f.qty>0&&refill>0)this.rows('INSERT OR IGNORE INTO rt_absorption VALUES (?,?,?,?,?)',p.market,p.ts,f.price,f.qty,refill);
        }
      }
    }
    this.books.set(p.market,p);
    this.rows('INSERT INTO rt_book VALUES (?,?,?,?,?,?,1) ON CONFLICT(market,sec) DO UPDATE SET ts=excluded.ts,received=excluded.received,bids=excluded.bids,asks=excluded.asks,frames=rt_book.frames+1',p.market,Math.floor(p.ts/1000),p.ts,p.received,JSON.stringify(p.bids),JSON.stringify(p.asks));
    return true;
  }
  reconcile(market,minute,expected,checked){
    if(!Number.isSafeInteger(minute)||minute%MINUTE||!finite(expected)||expected<0||checked<minute+MINUTE)throw Error('INVALID_CLOSED_CANDLE');
    const actual=this.rows('SELECT COALESCE(SUM(price*qty),0) AS n FROM rt_trade WHERE market=? AND ts>=? AND ts<?',market,minute,minute+MINUTE)[0].n;
    const error=expected===0?(actual===0?0:1):Math.abs(actual-expected)/expected;
    const status=error<=.005?'MATCHED':'MISMATCH';
    this.rows('INSERT OR REPLACE INTO rt_reconcile VALUES (?,?,?,?,?,?,?)',market,minute,expected,actual,error,status,checked);
    return {status,expected,actual,relative_error:error};
  }
  summary(market,now,minutes){
    if(![1,5,15,30].includes(minutes)||!Number.isSafeInteger(now))throw Error('INVALID_WINDOW');
    const end=Math.floor(now/MINUTE)*MINUTE,start=end-minutes*MINUTE,reasons=[];
    const v=this.rows('SELECT COUNT(*) AS n,COALESCE(SUM(CASE WHEN side=\'BID\' THEN price*qty ELSE 0 END),0) AS buy,COALESCE(SUM(CASE WHEN side=\'ASK\' THEN price*qty ELSE 0 END),0) AS sell FROM rt_trade WHERE market=? AND ts>=? AND ts<?',market,start,end)[0];
    const session=this.rows('SELECT 1 FROM rt_session WHERE market=? AND start_ms<=? AND last_ms>=? AND (end_ms IS NULL OR end_ms>=?) LIMIT 1',market,start,end,end);
    if(!session.length)reasons.push('SESSION_NOT_CONTINUOUS');
    const proofs=this.rows('SELECT * FROM rt_reconcile WHERE market=? AND minute>=? AND minute<?',market,start,end);
    if(proofs.length!==minutes)reasons.push('RECONCILIATION_MISSING');
    if(proofs.some(x=>x.status!=='MATCHED'))reasons.push('CANDLE_MISMATCH');
    const bad=this.rows('SELECT DISTINCT reason FROM rt_quality WHERE market=? AND ts<? AND until_ms>?',market,end,start);
    reasons.push(...bad.map(x=>x.reason));
    const books=this.rows('SELECT COUNT(*) AS n FROM rt_book WHERE market=? AND sec>=? AND sec<?',market,start/1000,end/1000)[0].n;
    if(books<minutes*60*.95)reasons.push('BOOK_COVERAGE_LOW');
    const absorption=this.rows('SELECT COUNT(*) AS n FROM rt_absorption WHERE market=? AND ts>=? AND ts<?',market,start,end)[0].n;
    const blocks=[];if(minutes>=5)for(let begin=start;begin<end;begin+=5*MINUTE){const b=this.rows('SELECT COALESCE(SUM(CASE WHEN side=\'BID\' THEN price*qty ELSE -price*qty END),0) AS net FROM rt_trade WHERE market=? AND ts>=? AND ts<?',market,begin,begin+5*MINUTE)[0];blocks.push({start_ms:begin,end_ms:begin+5*MINUTE,net_buy_krw:b.net});}
    return {market,venue:'bithumb',unit:'KRW',start_ms:start,end_ms:end,minutes,verified:reasons.length===0,reasons:[...new Set(reasons)],trade_count:v.n,buy_krw:v.buy,sell_krw:v.sell,net_buy_krw:v.buy-v.sell,matched_minutes:proofs.filter(x=>x.status==='MATCHED').length,book_seconds:books,blocks,absorption_like_count:absorption,absorption_confirmed:false,full_market_cvd:false,verification_scope:'OBSERVED_STREAM_RECONCILED_TO_VENUE_MINUTE_TOTALS',observation_only:true,send_allowed:false};
  }
  prune(now,retentionMs=7200000){
    if(retentionMs<1800000)throw Error('RETENTION_TOO_SHORT');const cutoff=now-retentionMs;
    for(const table of ['rt_trade','rt_book','rt_quality','rt_absorption'])this.rows(`DELETE FROM ${table} WHERE ts<?`,cutoff);
    this.rows('DELETE FROM rt_reconcile WHERE minute<?',cutoff);this.rows('DELETE FROM rt_session WHERE end_ms IS NOT NULL AND end_ms<?',cutoff);
  }
}
