export const NOW=Date.UTC(2026,10,6,0,16),END=Math.floor(NOW/300000)*300000;
export function packet(mode='fall'){
 const items=[];
 for(const asset of ['BTC','ETH','XRP'])for(const venue of ['bitget','bithumb']){
  const scale=venue==='bithumb'?1400:1;const symbol=venue==='bithumb'?'KRW-'+asset:asset+'USDT';
  const prices=mode==='flat'?[100,100,100,100]:[100,99.5,99,98.5];
  const bars=prices.map((close,i)=>({start_ms:END-(4-i)*300000,open:close*scale,high:(close+.1)*scale,low:(close-.1)*scale,close:close*scale}));
  const price=mode==='rebound'?100:prices.at(-1);
  items.push({venue,asset,symbol,source:'OFFICIAL_NATIVE_5M_AND_QUOTES',fetched_at_ms:NOW-1000,bars,
   quote:{bid:(price-.01)*scale,ask:(price+.01)*scale,at_ms:NOW-1000}});
 }
 return {version:'IRYS_V34_CROSS_VENUE_DROP_V1',model_digest:'MODEL',source:'OFFICIAL_PUBLIC_MARKETS',at_ms:NOW,started_at_ms:NOW-10000,
  items,provider_errors:[],orders_sent:false,telegram_sent:false};
}
