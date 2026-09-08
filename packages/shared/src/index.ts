export type MarketStatus = 'LISTED'|'TRADING'|'LOCKED'|'RESOLVED'|'VOIDED';
export type Side = 'UP'|'DOWN';
export interface Market { id:string; marketId:string; symbol:string; asset:'BTC'|'ETH'; intervalSeconds:number; openPrice:number; currentPrice:number; expiry:number; status:MarketStatus; upPrice:number; downPrice:number; liquidity:number; spread:number; }
export interface Level { price:number; quantity:number; }
export interface OrderBook { bids:Level[]; asks:Level[]; }
export interface Signal { direction:Side|'HOLD'; marketProbability:number; modelProbability:number; edge:number; confidence:number; score:number; momentum:number; volatility:number; obi:number; termStructure:number; rationale:string[]; }
export interface Trade { id:string; marketId:string; wallet:string; side:Side; quantity:number; entryPrice:number; executionPrice:number; cost:number; payout:number; pnl:number; status:'OPEN'|'SETTLED'; txHash:string; timestamp:number; }
export interface RiskResult { allowed:boolean; checks:Record<string,boolean>; reasons:string[]; }
