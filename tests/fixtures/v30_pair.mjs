const T=1793729100000;
function item(direction='LONG',venue='bitget'){
 const up=direction!=='SHORT',symbol=venue==='bithumb'?'KRW-TEST':'TESTUSDT';
 const candidate={venue,symbol,direction:venue==='bithumb'?'BUY':direction,anchor_price:up?98:104};
 const firstAt=T-16000,secondAt=T-4000;
 const rows=(prices,base,prefix)=>prices.map((price,i)=>({id:prefix+i,at_ms:base+i*2000,price,size:10,side:up?'BUY':'SELL'}));
 const first={venue,symbol,observed_at_ms:firstAt,quote:{bid:up?99.8:102.1,ask:up?99.9:102.2,at_ms:firstAt-200},trades:rows(up?[99,99.3,99.6,99.9]:[103,102.7,102.4,102.1],firstAt-7000,'a')};
 const second={venue,symbol,observed_at_ms:secondAt,quote:{bid:up?100.6:101.3,ask:up?100.7:101.4,at_ms:secondAt-200},trades:rows(up?[100,100.3,100.6,100.8]:[102,101.7,101.4,101.2],secondAt-7000,'b')};
 const risk={at_ms:T-2000,source:venue==='bithumb'?'BITHUMB_OFFICIAL_MARKETS_AND_WARNINGS':'BITGET_OFFICIAL_V2_V3',market:{market:symbol,market_warning:'NONE'},warnings:[],instrument:{symbol,symbolType:'crypto',instrumentType:'crypto'},contract:{symbol,symbolStatus:'normal',symbolType:'perpetual',quoteCoin:'USDT'}};
 const final={venue,symbol,observed_at_ms:T-500,quote:{bid:up?100.7:101.2,ask:up?100.8:101.3,at_ms:T-800}};
 return {candidate,first,second,final,risk};
}

export {item,T};
