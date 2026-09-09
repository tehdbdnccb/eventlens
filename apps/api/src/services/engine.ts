import {fairProbability,momentum,orderBookImbalance,scoreSignal,confidence,crossWindowDeviation} from '@eventlens/quant';
import type {Market,Signal,OrderBook} from '@eventlens/shared'; 
import {demoBooks} from './demo.js';

function getOrderBook(marketId: string): OrderBook {
  // Return demo book if available (for demo markets)
  if (demoBooks[marketId]) {
    return demoBooks[marketId];
  }
  
  // Fallback: generate a neutral order book for synthetic/unknown markets
  return {
    bids: [
      { price: 0.48, quantity: 1000 },
      { price: 0.46, quantity: 800 },
      { price: 0.44, quantity: 600 },
    ],
    asks: [
      { price: 0.52, quantity: 1000 },
      { price: 0.54, quantity: 800 },
      { price: 0.56, quantity: 600 },
    ],
  };
}

export function buildSignal(m:Market,all:Market[]):Signal{
  const tau=Math.max((m.expiry-Date.now())/1000,1);
  const vol=m.asset==='BTC'?.72:.95;
  const model=fairProbability(m.currentPrice,m.openPrice,vol,tau);
  const edge=model-m.upPrice;
  const book=getOrderBook(m.marketId);
  const obi=orderBookImbalance(book.bids,book.asks);
  const mom=momentum(m.currentPrice,m.openPrice);
  const peers=all.filter(x=>x.asset===m.asset&&x.marketId!==m.marketId).map(x=>x.upPrice);
  const term=crossWindowDeviation(m.upPrice,peers);
  const score=scoreSignal(edge,obi,mom,term);
  return {
    direction:score>.20?'UP':score<-.20?'DOWN':'HOLD',
    marketProbability:m.upPrice,
    modelProbability:model,
    edge,
    confidence:confidence(edge,obi,mom,term),
    score,
    momentum:mom,
    volatility:vol,
    obi,
    termStructure:term,
    rationale:[
      `Market implies ${(m.upPrice*100).toFixed(1)}% Up`,
      `Model fair value ${(model*100).toFixed(1)}%`,
      `Order-book imbalance ${(obi*100).toFixed(1)}%`,
      `Momentum ${(mom*100).toFixed(2)}%`,
      `Cross-window deviation ${(term*100).toFixed(1)}%`
    ]
  };
}

