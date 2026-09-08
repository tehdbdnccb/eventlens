import {DemoAdapter} from './demo.js'; import {buildSignal} from './engine.js'; import {evaluateTrade} from '@eventlens/risk'; import type {Side} from '@eventlens/shared';
export const adapter=new DemoAdapter();
export async function snapshot(){const markets=await adapter.discoverMarkets(); return markets.map(m=>({...m,signal:buildSignal(m,markets)}));}
export async function detail(id:string){const markets=await adapter.discoverMarkets();const market=markets.find(m=>m.marketId===id)??markets[0];return {...market,signal:buildSignal(market,markets),orderbook:await adapter.orderBook(market.marketId)};}
export async function preview(input:{marketId:string;side:Side;quantity:number;wallet:string}){const d=await detail(input.marketId);const risk=evaluateTrade(d,d.signal,input.side,input.quantity,0);return {ok:risk.allowed,checks:risk.checks,reasons:risk.reasons,price:input.side==='UP'?d.upPrice:d.downPrice,cost:(input.side==='UP'?d.upPrice:d.downPrice)*input.quantity};}
export async function execute(input:{marketId:string;side:Side;quantity:number;wallet:string}){const p=await preview(input);if(!p.ok) return {ok:false,checks:p.checks,reasons:p.reasons};return {ok:true,trade:await adapter.execute({...input,maxPrice:p.price})};}
export function trades(){return adapter.listTrades();}
