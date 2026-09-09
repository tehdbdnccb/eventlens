import { DemoAdapter } from './demo.js';
import { SomniaDreamDexAdapter } from '@eventlens/dreamdex';
import { buildSignal } from './engine.js';
import { evaluateTrade } from '@eventlens/risk';
import type { Side, Market } from '@eventlens/shared';
import type { DreamDexAdapter } from '@eventlens/dreamdex';

const DEMO_MODE = process.env.DEMO_MODE === 'true';

// Initialize adapter based on DEMO_MODE
function initializeAdapter(): DreamDexAdapter {
  if (DEMO_MODE) {
    console.log('[marketService] Initializing in DEMO mode');
    return new DemoAdapter();
  }

  console.log('[marketService] Initializing DREAMDEX live mode with Somnia testnet');
  const config = {
    indexerUrl: process.env.SOMNIA_INDEXER_URL || 'https://prd.smk.somnia.host/v1/graphql',
    wsRpcUrl: process.env.SOMNIA_WS_RPC_URL || 'wss://api.infra.testnet.somnia.network/ws',
    network: (process.env.SOMNIA_NETWORK || 'shannon') as 'mainnet' | 'shannon',
    privateKey: process.env.SOMNIA_PRIVATE_KEY as `0x${string}` | undefined,
  };
  return new SomniaDreamDexAdapter(config);
}

const adapter = initializeAdapter();

// Market cache with TTL
let marketCache: Map<string, { data: Market; timestamp: number }> = new Map();
const CACHE_TTL = DEMO_MODE ? 1000 : 5000; // 1s for demo, 5s for live
let lastFetchTime = 0;
let isFetching = false;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 5;

async function getMarketsWithCache(): Promise<Market[]> {
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
    const markets = await adapter.discoverMarkets();
    
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
    console.error(
      `[marketService] Error fetching markets (attempt ${consecutiveErrors}):`,
      error instanceof Error ? error.message : String(error)
    );

    // Return cached markets if available, even if stale
    const cached = Array.from(marketCache.values()).map(entry => entry.data);
    if (cached.length > 0) {
      console.warn('[marketService] Returning stale cached markets');
      return cached;
    }

    // After too many consecutive errors, fail loudly
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      throw new Error(`Market fetch failed ${consecutiveErrors} times: ${error instanceof Error ? error.message : String(error)}`);
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
    console.warn('[marketService] Error fetching orderbook for', market.marketId);
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
    console.error('[marketService] Error executing trade:', error);
    return {
      ok: false,
      checks: [],
      reasons: [error instanceof Error ? error.message : 'Trade execution failed'],
    };
  }
}

export function trades() {
  return adapter.listTrades();
}

export function isLiveMode() {
  return !DEMO_MODE;
}

export function getAdapterStatus() {
  return {
    mode: DEMO_MODE ? 'demo' : 'live',
    consecutiveErrors,
    cachedMarketsCount: marketCache.size,
    lastFetchTime: new Date(lastFetchTime).toISOString(),
  };
}

