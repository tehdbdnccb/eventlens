import type {Market,OrderBook,Trade,Side} from '@eventlens/shared';
export interface DreamDexAdapter{discoverMarkets():Promise<Market[]>; orderBook(marketId:string):Promise<OrderBook>; execute(input:{marketId:string;side:Side;quantity:number;maxPrice:number;wallet:string}):Promise<Trade>;}
export {SomniaMarkets} from '@somnia-chain/markets-sdk';
export const TESTNET_CHAIN_ID=50312; export const MAINNET_CHAIN_ID=5031;
export {SomniaDreamDexAdapter} from './somnia.js';
