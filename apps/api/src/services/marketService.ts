import { DemoAdapter } from './demo.js';
import { SomniaDreamDexAdapter } from '@eventlens/dreamdex';
import { buildSignal } from './engine.js';
import { evaluateTrade } from '@eventlens/risk';
import type { Side, Market } from '@eventlens/shared';
import type { DreamDexAdapter } from '@eventlens/dreamdex';

const DEMO_MODE = process.env.DEMO_MODE === 'true';

console.log('[marketService] Starting initialization with DEMO_MODE=', DEMO_MODE);

// Initialize adapter based on DEMO_MODE
let adapter: DreamDexAdapter;
let initError: Error | null = null;

try {
  if (DEMO_MODE) {
    console.log('[marketService] Initializing in DEMO mode');
    adapter = new DemoAdapter();
    console.log('[marketService] DemoAdapter created successfully');
  } else {
    console.log('[marketService] Initializing DREAMDEX live mode with Somnia testnet');
    const config = {
      indexerUrl: process.env.SOMNIA_INDEXER_URL || 'https://prd.smk.somnia.host/v1/graphql',
      wsRpcUrl: process.env.SOMNIA_WS_RPC_URL || 'wss://api.infra.testnet.somnia.network/ws',
      network: (process.env.SOMNIA_NETWORK || 'shannon') as 'mainnet' | 'shannon',
      privateKey: process.env.SOMNIA_PRIVATE_KEY as `0x${string}` | undefined,
    };
    console.log('[marketService] Somnia config prepared:', {
      network: config.network,
      indexerUrl: config.indexerUrl.substring(0, 50) + '...',
      wsRpcUrl: config.wsRpcUrl.substring(0, 50) + '...',
    });
    
    adapter = new SomniaDreamDexAdapter(config);
    console.log('[marketService] SomniaDreamDexAdapter created successfully');
  }
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error);
  console.error('[marketService] CRITICAL: Adapter initialization failed:', msg);
  console.error('[marketService] Stack:', error instanceof Error ? error.stack : 'no stack');
  initError = error instanceof Error ? error : new Error(msg);
  
  // Create a fallback demo adapter so the service doesn't crash
  console.warn('[marketService] Falling back to DemoAdapter');
  adapter = new DemoAdapter();
}

// Market cache with TTL
let marketCache: Map<string, { data: Market; timestamp: number }> = new Map();
const CACHE_TTL = DEMO_MODE ? 1000 : 5000; // 1s for demo, 5s for live
let lastFetchTime = 0;
let isFetching = false;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 5;

export async function getMarketsWithCache(): Promise<Market[]> {
  const now = Date.now();
  
  // Return cached markets if still valid
  if (marketCache.size > 0 && now - lastFetchTime < CACHE_TTL) {
    return Array.from(marketCache.values()).map(entry => entry.data);
  }

  // Prevent concurrent fetches
  if (isFetching) {
    return Array.from(marketCache.values()).map(entry => entry.data);
  }

  isFetching = true;
  try {
    console.log('[marketService] Calling adapter.discoverMarkets()');
    const markets = await adapter.discoverMarkets();
    console.log('[marketService] discoverMarkets returned', markets.length, 'markets');
    
    if (markets.length === 0) {
      throw new Error('No markets returned from adapter');
    }

    marketCache.clear();
    markets.forEach(m => {
      marketCache.set(m.id, { data: m, timestamp: now });
    });
    
    lastFetchTime = now;
    consecutiveErrors = 0; // Reset error counter on success
    
    return markets;
  } catch (error) {
    consecutiveErrors++;
    const msg = error instanceof Error ? error.message : String(error);
    console.error(
      `[marketService] Error fetching markets (attempt ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`,
      msg
    );
    if (error instanceof Error) {
      console.error('[marketService] Stack:', error.stack);
    }

    // Return cached markets if available, even if stale
    const cached = Array.from(marketCache.values()).map(entry => entry.data);
    if (cached.length > 0) {
      console.warn('[marketService] Returning stale cached markets, count:', cached.length);
      return cached;
    }

    // After too many consecutive errors, fail loudly
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      const finalMsg = `Market fetch failed ${consecutiveErrors} times: ${msg}`;
      console.error('[marketService]', finalMsg);
      throw new Error(finalMsg);
    }

    throw error;
  } finally {
    isFetching = false;
  }
}

export async function snapshot() {
  const markets = await getMarketsWithCache();
  return markets.map(m => ({
    ...m,
    signal: buildSignal(m, markets),
  }));
}

export async function detail(id: string) {
  const markets = await getMarketsWithCache();
  const market = markets.find(m => m.marketId === id) ?? markets[0];
  
  let orderbook;
  try {
    orderbook = await adapter.orderBook(market.marketId);
  } catch (error) {
    console.warn('[marketService] Error fetching orderbook for', market.marketId, ':', error instanceof Error ? error.message : String(error));
    orderbook = { bids: [], asks: [] };
  }

  return {
    ...market,
    signal: buildSignal(market, markets),
    orderbook,
  };
}

export async function preview(input: {
  marketId: string;
  side: Side;
  quantity: number;
  wallet: string;
}) {
  const d = await detail(input.marketId);
  const risk = evaluateTrade(d, d.signal, input.side, input.quantity, 0);
  return {
    ok: risk.allowed,
    checks: risk.checks,
    reasons: risk.reasons,
    price: input.side === 'UP' ? d.upPrice : d.downPrice,
    cost: (input.side === 'UP' ? d.upPrice : d.downPrice) * input.quantity,
  };
}

export async function execute(input: {
  marketId: string;
  side: Side;
  quantity: number;
  wallet: string;
}) {
  const p = await preview(input);
  if (!p.ok) {
    return { ok: false, checks: p.checks, reasons: p.reasons };
  }

  try {
    const trade = await adapter.execute({
      ...input,
      maxPrice: p.price,
    });
    return { ok: true, trade };
  } catch (error) {
    console.error('[marketService] Error executing trade:', error instanceof Error ? error.message : String(error));
    return {
      ok: false,
      checks: [],
      reasons: [error instanceof Error ? error.message : 'Trade execution failed'],
    };
  }
}

export function trades() {
  return adapter.listTrades ? adapter.listTrades() : [];
}

export function isLiveMode() {
  return !DEMO_MODE && !initError;
}

export function getAdapterStatus() {
  return {
    mode: DEMO_MODE ? 'demo' : 'live',
    initError: initError ? initError.message : null,
    consecutiveErrors,
    cachedMarketsCount: marketCache.size,
    lastFetchTime: new Date(lastFetchTime).toISOString(),
  };
}

