import {SomniaMarkets, SOMNIA_MAINNET_ADDRESSES, SOMNIA_TESTNET_ADDRESSES} from '@somnia-chain/markets-sdk';
import {somniaMainnet, somniaShannon} from '@somnia-chain/markets-sdk/chains';
import type {Market,OrderBook,Trade,Side} from '@eventlens/shared';
import type {DreamDexAdapter} from './index.js';

export interface SomniaConfig { indexerUrl:string; wsRpcUrl:string; privateKey?:`0x${string}`; network:'mainnet'|'shannon'; }

export class SomniaDreamDexAdapter implements DreamDexAdapter {
  private exchange:any;
  constructor(config:SomniaConfig){
    const isMainnet=config.network==='mainnet';
    this.exchange=new SomniaMarkets({indexerUrl:config.indexerUrl,wsRpcUrl:config.wsRpcUrl,chain:isMainnet?somniaMainnet:somniaShannon,addresses:isMainnet?SOMNIA_MAINNET_ADDRESSES:SOMNIA_TESTNET_ADDRESSES,...(config.privateKey?{privateKey:config.privateKey}: {})});
  }
  async discoverMarkets():Promise<Market[]>{
    const rows=Object.values(await this.exchange.loadMarkets(true)) as any[];
    return rows.filter((x:any)=>x.active&&x.info?.marketType==='binary').map((x:any)=>{const i=x.info; const up=x.outcomes?.[0]; const down=x.outcomes?.[1]; const upPrice=Number(up?.price??0); return {id:String(i.marketId),marketId:String(i.marketId),symbol:String(up?.symbol??x.symbol??i.marketId),asset:String(i.symbol??x.base??'BTC').toUpperCase().startsWith('ETH')?'ETH':'BTC',intervalSeconds:Number(i.intervalSeconds??900),openPrice:Number(i.openPrice??0),currentPrice:Number(i.currentPrice??i.markPrice??0),expiry:Number(i.expiryTimestampMs??i.expiry??Date.now()),status:'TRADING',upPrice,downPrice:Number(down?.price??(1-upPrice)),liquidity:Number(x.info?.liquidity??0),spread:0} as Market;});
  }
  async orderBook(marketId:string):Promise<OrderBook>{const markets=await this.exchange.loadMarkets(true);const m=Object.values(markets).find((x:any)=>String(x.info?.marketId)===marketId) as any; if(!m?.outcomes?.[0]?.symbol) return {bids:[],asks:[]}; const b=await this.exchange.fetchOrderBook(m.outcomes[0].symbol,10); return {bids:(b.bids??[]).map((x:any)=>({price:Number(x[0]),quantity:Number(x[1])})),asks:(b.asks??[]).map((x:any)=>({price:Number(x[0]),quantity:Number(x[1])}))};}
  async execute(input:{marketId:string;side:Side;quantity:number;maxPrice:number;wallet:string}):Promise<Trade>{const markets=await this.exchange.loadMarkets(true);const m=Object.values(markets).find((x:any)=>String(x.info?.marketId)===input.marketId) as any; if(!m) throw new Error('Market not found'); const onchain=await this.exchange.client.getMarketOnchain(input.marketId as `0x${string}`); if(onchain.status!==1) throw new Error(`Market is not Trading (status ${onchain.status})`); const symbol=input.side==='UP'?m.outcomes[0].symbol:m.outcomes[1].symbol; const result=await this.exchange.createOrder(symbol,'limit','buy',input.quantity,input.maxPrice,{timeInForce:'IOC'}); const receipt=(result.info as any)?.receipt; return {id:String(result.id??Date.now()),marketId:input.marketId,wallet:input.wallet,side:input.side,quantity:input.quantity,entryPrice:input.maxPrice,executionPrice:input.maxPrice,cost:input.maxPrice*input.quantity,payout:input.quantity,pnl:0,status:'OPEN',txHash:String(receipt?.transactionHash??''),timestamp:Date.now()};}
}
