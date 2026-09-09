import { DemoAdapter } from './demo.js';
import { SyntheticAdapter } from './syntheticAdapter.js';
import { SomniaDreamDexAdapter } from '@eventlens/dreamdex';
import { buildSignal } from './engine.js';
import { evaluateTrade } from '@eventlens/risk';
import type { Side, Market } from '@eventlens/shared';
import type { DreamDexAdapter } from '@eventlens/dreamdex';

const DEMO_MODE = process.env.DEMO_MODE === 'true';
const USE_SYNTHETIC = process.env.USE_SYNTHETIC === 'true';

console.log('[marketService] ===== MODULE LOAD START =====');
console.log('[marketService] DEMO_MODE =', DEMO_MODE);
console.log('[marketService] USE_SYNTHETIC =', USE_SYNTHETIC);
if (!DEMO_MODE && !USE_SYNTHETIC) {
  console.log('[marketService] SOMNIA_NETWORK =', process.env.SOMNIA_NETWORK);
  console.log('[marketService] SOMNIA_INDEXER_URL =', process.env.SOMNIA_INDEXER_URL?.substring(0, 50));
}

let adapter: DreamDexAdapter;
let initError: Error | null = null;

try {
  if (DEMO_MODE) {
    console.log('[marketService] Creating DemoAdapter...');
    adapter = new DemoAdapter();
    console.log('[marketService] DemoAdapter created successfully');
  } else if (USE_SYNTHETIC) {
    console.log('[marketService] Creating SyntheticAdapter with hardcoded binary markets...');
    adapter = new SyntheticAdapter();
    console.log('[marketService] SyntheticAdapter created successfully');
  } else {
    console.log('[marketService] Creating SomniaDreamDexAdapter...');
    const config = {
      indexerUrl: process.env.SOMNIA_INDEXER_URL || 'https://prd.smk.somnia.host/v1/graphql',
      wsRpcUrl: process.env.SOMNIA_WS_RPC_URL || 'wss://api.infra.testnet.somnia.network/ws',
      network: (process.env.SOMNIA_NETWORK || 'shannon') as 'mainnet' | 'shannon',
      privateKey: process.env.SOMNIA_PRIVATE_KEY as `0x${string}` | undefined,
    };
    console.log('[marketService] Somnia config:', { network: config.network });
    
    adapter = new SomniaDreamDexAdapter(config);
    console.log('[marketService] SomniaDreamDexAdapter created successfully');
  }
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error);
  console.error('[marketService] CRITICAL: Adapter initialization failed:', msg);
  if (error instanceof Error && error.stack) {
    console.error('[marketService] Stack:', error.stack);
  }
  initError = error instanceof Error ? error : new Error(msg);
  
  console.warn('[marketService] Falling back to SyntheticAdapter');
  adapter = new SyntheticAdapter();
}

console.log('[marketService] ===== MODULE LOAD END =====\n');

let marketCache: Map<string, { data: Market; timestamp: number }> = new Map();
const CACHE_TTL = USE_SYNTHETIC ? 500 : (DEMO_MODE ? 1000 : 5000);
let lastFetchTime = 0;
let isFetching = false;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 10;

export async function getMarketsWithCache(): Promise<Market[]> {
  const now = Date.now();
  
  if (marketCache.size > 0 && now - lastFetchTime < CACHE_TTL) {
    return Array.from(marketCache.values()).map(entry => entry.data);
  }

  if (isFetching) {
    return Array.from(marketCache.values()).map(entry => entry.data);
  }

  isFetching = true;
  try {
    const markets = await adapter.discoverMarkets();
    
    if (markets.length === 0) {
      throw new Error('No markets returned from adapter');
    }

    marketCache.clear();
    markets.forEach(m => {
      marketCache.set(m.id, { data: m, timestamp: now });
    });
    
    lastFetchTime = now;
    consecutiveErrors = 0;
    
    return markets;
  } catch (error) {
    consecutiveErrors++;
    const msg = error instanceof Error ? error.message : String(error);
    console.error(
      `[marketService] Error fetching markets (attempt ${consecutiveErrors}):`,
      msg
    );

    const cached = Array.from(marketCache.values()).map(entry => entry.data);
    if (cached.length > 0) {
      return cached;
    }

    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      throw new Error(`Market fetch failed ${consecutiveErrors} times: ${msg}`);
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
    console.error('[marketService] Execute error:', error instanceof Error ? error.message : String(error));
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
  return !DEMO_MODE && (USE_SYNTHETIC || !initError);
}

export function getAdapterStatus() {
  return {
    mode: DEMO_MODE ? 'demo' : (USE_SYNTHETIC ? 'synthetic' : 'live'),
    initError: initError ? initError.message : null,
    consecutiveErrors,
    cachedMarketsCount: marketCache.size,
    lastFetchTime: lastFetchTime > 0 ? new Date(lastFetchTime).toISOString() : 'never',
  };
}

