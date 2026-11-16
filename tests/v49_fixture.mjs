export const T=1794000000000, M=60000;
export function item(dir='LONG',symbol='AAAUSDT',at=T){
 const venue=dir==='BUY'?'bithumb':'bitget',side=dir==='SHORT'?'SELL':'BUY',step=dir==='SHORT'?-1:1;
 return {candidate:{venue,symbol,direction:dir,anchor_price:98,discovery_price:100},
  first:{venue,symbol,observed_at_ms:at-15000,quote:{bid:99.9,ask:100,at_ms:at-15100},trades:[0,1,2].map(i=>({id:'f'+i,at_ms:at-22000+i*2000,price:99.8+step*i*.05,size:10,side}))},
  second:{venue,symbol,observed_at_ms:at-3000,quote:{bid:100+step*.5,ask:100.1+step*.5,at_ms:at-3500},trades:[0,1,2].map(i=>({id:'s'+i,at_ms:at-9500+i*2500,price:100+step*i*.1,size:10,side}))},
  final:{venue,symbol,observed_at_ms:at-200,quote:{bid:100+step*.6,ask:100.1+step*.6,at_ms:at-500}}};
}
export function packet(items=[item()],at=T){return {version:'IRYS_V30_PUBLIC_PAIRED_DIRECTION_V1',source:'OFFICIAL_PUBLIC_RUNNER',model_digest:'exact',started_at_ms:at-30000,at_ms:at,checks:[],items,orders_sent:false,telegram_sent:false};}
