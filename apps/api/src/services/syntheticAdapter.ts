import type { Market, OrderBook, Trade, Side } from '@eventlens/shared';
import type { DreamDexAdapter } from '@eventlens/dreamdex';

/**
 * SyntheticAdapter provides realistic hardcoded binary market data for BTC/ETH
 * with time-based price simulation. This bypasses SDK integration issues while
 * providing realistic market structure for testing and development.
 */

interface SyntheticMarketConfig {
  id: string;
  symbol: string;
  asset: 'BTC' | 'ETH';
  basePrice: number;
  volatility: number;
  liquidity: number;
}

const SYNTHETIC_MARKETS: SyntheticMarketConfig[] = [
  // BTC Markets
  { id: 'btc-up-5m', symbol: 'BTC Up 5m', asset: 'BTC', basePrice: 0.52, volatility: 0.15, liquidity: 10000 },
  { id: 'btc-down-5m', symbol: 'BTC Down 5m', asset: 'BTC', basePrice: 0.48, volatility: 0.15, liquidity: 9500 },
  { id: 'btc-up-15m', symbol: 'BTC Up 15m', asset: 'BTC', basePrice: 0.55, volatility: 0.12, liquidity: 12000 },
  { id: 'btc-down-15m', symbol: 'BTC Down 15m', asset: 'BTC', basePrice: 0.45, volatility: 0.12, liquidity: 11500 },
  { id: 'btc-up-1h', symbol: 'BTC Up 1h', asset: 'BTC', basePrice: 0.58, volatility: 0.10, liquidity: 15000 },
  { id: 'btc-down-1h', symbol: 'BTC Down 1h', asset: 'BTC', basePrice: 0.42, volatility: 0.10, liquidity: 14500 },
  
  // ETH Markets
  { id: 'eth-up-5m', symbol: 'ETH Up 5m', asset: 'ETH', basePrice: 0.51, volatility: 0.16, liquidity: 8000 },
  { id: 'eth-down-5m', symbol: 'ETH Down 5m', asset: 'ETH', basePrice: 0.49, volatility: 0.16, liquidity: 7800 },
  { id: 'eth-up-15m', symbol: 'ETH Up 15m', asset: 'ETH', basePrice: 0.54, volatility: 0.13, liquidity: 10000 },
  { id: 'eth-down-15m', symbol: 'ETH Down 15m', asset: 'ETH', basePrice: 0.46, volatility: 0.13, liquidity: 9700 },
  { id: 'eth-up-1h', symbol: 'ETH Up 1h', asset: 'ETH', basePrice: 0.56, volatility: 0.11, liquidity: 12000 },
  { id: 'eth-down-1h', symbol: 'ETH Down 1h', asset: 'ETH', basePrice: 0.44, volatility: 0.11, liquidity: 11800 },
];

/**
 * Generate time-based price with volatility simulation
 * Uses current timestamp to create deterministic but changing prices
 */
function generateTimeBasedPrice(basePrice: number, volatility: number, marketId: string): number {
  const now = Date.now();
  const seconds = Math.floor(now / 1000);
  const msWithinSecond = now % 1000;
  
  // Create a pseudo-random but deterministic value based on marketId and time
  const marketHash = marketId.split('').reduce((h, c) => ((h << 5) - h) + c.charCodeAt(0), 0);
  const timeValue = (seconds + marketHash) % 100;
  
  // Oscillate price within volatility bounds
  const oscillation = Math.sin(timeValue / 10) * volatility;
  const price = Math.max(0.05, Math.min(0.95, basePrice + oscillation));
  
  // Add tiny sub-second variation for realism
  const microVariation = (msWithinSecond / 1000) * volatility * 0.1;
  return Math.max(0.01, Math.min(0.99, price + microVariation));
}

export class SyntheticAdapter implements DreamDexAdapter {
  private marketConfigs: Map<string, SyntheticMarketConfig>;
  private executedTrades: Trade[] = [];
  private nextTradeId = 1;

  constructor() {
    this.marketConfigs = new Map(SYNTHETIC_MARKETS.map(m => [m.id, m]));
    console.log(`[SyntheticAdapter] Initialized with ${this.marketConfigs.size} synthetic markets`);
  }

  async discoverMarkets(): Promise<Market[]> {
    return Array.from(this.marketConfigs.values()).map(config => {
      const upPrice = generateTimeBasedPrice(config.basePrice, config.volatility, `${config.id}-up`);
      const downPrice = 1 - upPrice;
      const currentPrice = (upPrice + downPrice) / 2;

      return {
        id: config.id,
        marketId: config.id,
        symbol: config.symbol,
        asset: config.asset,
        currentPrice,
        upPrice,
        downPrice,
        liquidity: config.liquidity,
        status: 'TRADING',
        expiry: Date.now() + 3600000, // 1 hour from now
        intervalSeconds: 300,
        openPrice: 0.5,
        spread: 0.02,
      } as Market;
    });
  }

  async orderBook(marketId: string): Promise<OrderBook> {
    const config = this.marketConfigs.get(marketId);
    if (!config) {
      return { bids: [], asks: [] };
    }

    const upPrice = generateTimeBasedPrice(config.basePrice, config.volatility, `${marketId}-up`);
    const spread = 0.02;

    // Generate realistic order book depth
    const bids = [
      { price: upPrice - spread * 2, quantity: config.liquidity * 0.1 },
      { price: upPrice - spread * 1.5, quantity: config.liquidity * 0.15 },
      { price: upPrice - spread, quantity: config.liquidity * 0.2 },
      { price: upPrice - spread / 2, quantity: config.liquidity * 0.25 },
    ];

    const asks = [
      { price: upPrice + spread / 2, quantity: config.liquidity * 0.25 },
      { price: upPrice + spread, quantity: config.liquidity * 0.2 },
      { price: upPrice + spread * 1.5, quantity: config.liquidity * 0.15 },
      { price: upPrice + spread * 2, quantity: config.liquidity * 0.1 },
    ];

    return { bids, asks };
  }

  async execute(input: {
    marketId: string;
    side: Side;
    quantity: number;
    maxPrice: number;
    wallet: string;
  }): Promise<Trade> {
    const config = this.marketConfigs.get(input.marketId);
    if (!config) {
      throw new Error(`Market ${input.marketId} not found`);
    }

    const executionPrice = input.side === 'UP'
      ? generateTimeBasedPrice(config.basePrice, config.volatility, `${input.marketId}-up`)
      : generateTimeBasedPrice(1 - config.basePrice, config.volatility, `${input.marketId}-down`);

    if (executionPrice > input.maxPrice) {
      throw new Error(`Execution price ${executionPrice.toFixed(4)} exceeds max price ${input.maxPrice.toFixed(4)}`);
    }

    const trade: Trade = {
      id: `synthetic-${this.nextTradeId++}`,
      marketId: input.marketId,
      wallet: input.wallet,
      side: input.side,
      quantity: input.quantity,
      entryPrice: input.maxPrice,
      executionPrice,
      cost: executionPrice * input.quantity,
      payout: input.quantity,
      pnl: 0,
      status: 'OPEN',
      txHash: `0x${Math.random().toString(16).slice(2)}`,
      timestamp: Date.now(),
    };

    this.executedTrades.push(trade);
    console.log(`[SyntheticAdapter] Executed trade: ${trade.id} for ${input.side} ${input.quantity} @ ${executionPrice.toFixed(4)}`);

    return trade;
  }

  listTrades(): Trade[] {
    return this.executedTrades;
  }
}

