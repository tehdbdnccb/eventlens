import type {Market,OrderBook,Trade,Side} from '@eventlens/shared';
export const demoMarkets=():Market[]=>{const now=Date.now(); return [
{id:'1',marketId:'btc-15m',symbol:'BTC-15M',asset:'BTC',intervalSeconds:900,openPrice:110250,currentPrice:110540,expiry:now+540000,status:'TRADING',upPrice:.582,downPrice:.418,liquidity:18420,spread:.005},
{id:'2',marketId:'btc-1h',symbol:'BTC-1H',asset:'BTC',intervalSeconds:3600,openPrice:110100,currentPrice:110540,expiry:now+2520000,status:'TRADING',upPrice:.641,downPrice:.359,liquidity:32600,spread:.005},
{id:'3',marketId:'eth-15m',symbol:'ETH-15M',asset:'ETH',intervalSeconds:900,openPrice:4320,currentPrice:4334,expiry:now+420000,status:'TRADING',upPrice:.531,downPrice:.469,liquidity:14200,spread:.006},
{id:'4',marketId:'eth-1h',symbol:'ETH-1H',asset:'ETH',intervalSeconds:3600,openPrice:4310,currentPrice:4334,expiry:now+2280000,status:'TRADING',upPrice:.598,downPrice:.402,liquidity:21900,spread:.0055}];};
export const demoBooks:Record<string,OrderBook>={
'btc-15m':{bids:[{price:.579,quantity:4200},{price:.575,quantity:1800},{price:.569,quantity:2400}],asks:[{price:.586,quantity:1200},{price:.591,quantity:1900},{price:.598,quantity:2500}]},
'btc-1h':{bids:[{price:.638,quantity:3400},{price:.633,quantity:2100}],asks:[{price:.644,quantity:1900},{price:.651,quantity:2800}]},
'eth-15m':{bids:[{price:.528,quantity:2200},{price:.522,quantity:1700}],asks:[{price:.536,quantity:1600},{price:.544,quantity:2600}]},
'eth-1h':{bids:[{price:.595,quantity:2500},{price:.588,quantity:1900}],asks:[{price:.602,quantity:1800},{price:.610,quantity:2200}]}};
export class DemoAdapter {private trades:Trade[]=[]; async discoverMarkets(){return demoMarkets();} async orderBook(id:string){return demoBooks[id]??demoBooks['btc-15m'];} async execute(i:{marketId:string;side:Side;quantity:number;maxPrice:number;wallet:string}){const m=(await this.discoverMarkets()).find(x=>x.marketId===i.marketId)!; const price=i.side==='UP'?m.upPrice:m.downPrice; const t:Trade={id:`trade-${Date.now()}`,marketId:i.marketId,wallet:i.wallet,side:i.side,quantity:i.quantity,entryPrice:price,executionPrice:price,cost:price*i.quantity,payout:i.quantity,pnl:(1-price)*i.quantity,status:'OPEN',txHash:`0xeventlensdemo${Date.now().toString(16)}`,timestamp:Date.now()}; this.trades.push(t); return t;} listTrades(){return this.trades;}}
