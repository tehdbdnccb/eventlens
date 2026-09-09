import { DemoAdapter } from './demo.js';
import { SomniaDreamDexAdapter } from '@eventlens/dreamdex';
import { buildSignal } from './engine.js';
import { evaluateTrade } from '@eventlens/risk';
import type { Side, Market } from '@eventlens/shared';
import type { DreamDexAdapter } from '@eventlens/dreamdex';

const DEMO_MODE = process.env.DEMO_MODE === 'true';
const DEBUG = process.env.DEBUG_MARKETS === 'true';

console.log('[marketService] ===== MODULE LOAD START =====');
console.log('[marketService] DEMO_MODE =', DEMO_MODE);
console.log('[marketService] DEBUG =', DEBUG);
console.log('[marketService] SOMNIA_NETWORK =', process.env.SOMNIA_NETWORK);
console.log('[marketService] SOMNIA_INDEXER_URL =', process.env.SOMNIA_INDEXER_URL?.substring(0, 50));
console.log('[marketService] SOMNIA_WS_RPC_URL =', process.env.SOMNIA_WS_RPC_URL?.substring(0, 50));

// Initialize adapter based on DEMO_MODE
let adapter: DreamDexAdapter;
let initError: Error | null = null;

try {
  if (DEMO_MODE) {
    console.log('[marketService] Creating DemoAdapter...');
    adapter = new DemoAdapter();
    console.log('[marketService] DemoAdapter created successfully');
  } else {
    console.log('[marketService] Creating SomniaDreamDexAdapter...');
    const config = {
      indexerUrl: process.env.SOMNIA_INDEXER_URL || 'https://prd.smk.somnia.host/v1/graphql',
      wsRpcUrl: process.env.SOMNIA_WS_RPC_URL || 'wss://api.infra.testnet.somnia.network/ws',
      network: (process.env.SOMNIA_NETWORK || 'shannon') as 'mainnet' | 'shannon',
      privateKey: process.env.SOMNIA_PRIVATE_KEY as `0x${string}` | undefined,
    };
    console.log('[marketService] Config:', { network: config.network, indexerUrl: config.indexerUrl, wsRpcUrl: config.wsRpcUrl });
    
    adapter = new SomniaDreamDexAdapter(config);
    console.log('[marketService] SomniaDreamDexAdapter created successfully');
  }
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error);
  console.error('[marketService] CRITICAL: Adapter initialization failed:', msg);
  if (error instanceof Error && error.stack) {
    console.error('[marketService] Stack trace:', error.stack);
  }
  initError = error instanceof Error ? error : new Error(msg);
  
  console.warn('[marketService] Falling back to DemoAdapter');
  adapter = new DemoAdapter();
}

console.log('[marketService] ===== MODULE LOAD END =====\n');

// Market cache with TTL
let marketCache: Map<string, { data: Market; timestamp: number }> = new Map();
const CACHE_TTL = DEMO_MODE ? 1000 : 5000;
let lastFetchTime = 0;
let isFetching = false;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 5;

export async function getMarketsWithCache(): Promise<Market[]> {
  const now = Date.now();
  const callId = Math.random().toString(36).slice(2, 8);
  
  if (DEBUG) console.log(`[marketService:${callId}] getMarketsWithCache called`);
  
  // Return cached markets if still valid
  if (marketCache.size > 0 && now - lastFetchTime < CACHE_TTL) {
    if (DEBUG) console.log(`[marketService:${callId}] Returning ${marketCache.size} cached markets (fresh)`);
    return Array.from(marketCache.values()).map(entry => entry.data);
  }

  // Prevent concurrent fetches
  if (isFetching) {
    if (DEBUG) console.log(`[marketService:${callId}] Already fetching, returning ${marketCache.size} cached markets`);
    return Array.from(marketCache.values()).map(entry => entry.data);
  }

  isFetching = true;
  try {
    if (DEBUG) console.log(`[marketService:${callId}] Calling adapter.discoverMarkets()...`);
    const startTime = Date.now();
    
    const markets = await adapter.discoverMarkets();
    
    const duration = Date.now() - startTime;
    if (DEBUG) console.log(`[marketService:${callId}] discoverMarkets returned in ${duration}ms with ${markets.length} markets`);
    
    if (markets.length === 0) {
      throw new Error('Adapter returned empty array');
    }

    marketCache.clear();
    markets.forEach(m => {
      marketCache.set(m.id, { data: m, timestamp: now });
    });
    
    lastFetchTime = now;
    consecutiveErrors = 0;
    
    if (DEBUG) console.log(`[marketService:${callId}] Success: cached ${markets.length} markets`);
    return markets;
  } catch (error) {
    consecutiveErrors++;
    const msg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : '';
    
    console.error(
      `[marketService:${callId}] ERROR (attempt ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${msg}`
    );
    if (stack && DEBUG) {
      console.error(`[marketService:${callId}] Stack:`, stack);
    }

    const cached = Array.from(marketCache.values()).map(entry => entry.data);
    if (cached.length > 0) {
      if (DEBUG) console.log(`[marketService:${callId}] Returning ${cached.length} stale cached markets`);
      return cached;
    }

    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      const finalMsg = `Market fetch failed ${consecutiveErrors} times: ${msg}`;
      console.error(`[marketService:${callId}] FATAL: ${finalMsg}`);
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
    if (DEBUG) console.warn('[marketService] orderBook error:', error instanceof Error ? error.message : String(error));
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
    console.error('[marketService] execute error:', error instanceof Error ? error.message : String(error));
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
    lastFetchTime: lastFetchTime > 0 ? new Date(lastFetchTime).toISOString() : 'never',
  };
}

