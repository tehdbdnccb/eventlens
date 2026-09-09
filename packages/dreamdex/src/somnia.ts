import {SomniaMarkets, SOMNIA_MAINNET_ADDRESSES, SOMNIA_TESTNET_ADDRESSES} from '@somnia-chain/markets-sdk';
import {somniaMainnet, somniaShannon} from '@somnia-chain/markets-sdk/chains';
import type {Market,OrderBook,Trade,Side} from '@eventlens/shared';
import type {DreamDexAdapter} from './index.js';

export interface SomniaConfig { 
  indexerUrl: string; 
  wsRpcUrl: string; 
  privateKey?: `0x${string}`; 
  network: 'mainnet' | 'shannon'; 
}

export class SomniaDreamDexAdapter implements DreamDexAdapter {
  private exchange: any;
  private config: SomniaConfig;
  private initPromise: Promise<void> | null = null;
  private isInitialized = false;

  constructor(config: SomniaConfig) {
    this.config = config;
    const isMainnet = config.network === 'mainnet';
    this.exchange = new SomniaMarkets({
      indexerUrl: config.indexerUrl,
      wsRpcUrl: config.wsRpcUrl,
      chain: isMainnet ? somniaMainnet : somniaShannon,
      addresses: isMainnet ? SOMNIA_MAINNET_ADDRESSES : SOMNIA_TESTNET_ADDRESSES,
      ...(config.privateKey ? { privateKey: config.privateKey } : {}),
    });
    console.log(`[SomniaDreamDexAdapter] Initialized with network=${config.network}, indexer=${config.indexerUrl}`);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        // Try to load markets once to verify connectivity
        const markets = await this.exchange.loadMarkets(true);
        console.log(`[SomniaDreamDexAdapter] Connectivity check passed, ${Object.keys(markets).length} markets loaded`);
        this.isInitialized = true;
      } catch (error) {
        console.error('[SomniaDreamDexAdapter] Initialization check failed:', error instanceof Error ? error.message : String(error));
        throw error;
      }
    })();

    return this.initPromise;
  }

  async discoverMarkets(): Promise<Market[]> {
    try {
      // Ensure exchange is initialized
      await this.ensureInitialized();

      console.log('[SomniaDreamDexAdapter] Loading markets...');
      const rawMarkets = await this.exchange.loadMarkets(true);
      
      if (!rawMarkets || typeof rawMarkets !== 'object') {
        console.warn('[SomniaDreamDexAdapter] loadMarkets returned invalid data:', typeof rawMarkets);
        return [];
      }

      const rows = Object.values(rawMarkets) as any[];
      console.log(`[SomniaDreamDexAdapter] Loaded ${rows.length} total markets from exchange`);

      if (rows.length === 0) {
        console.warn('[SomniaDreamDexAdapter] No markets returned from loadMarkets');
        return [];
      }

      // Log first few markets for debugging
      rows.slice(0, 3).forEach((m: any) => {
        console.log(`[SomniaDreamDexAdapter] Market sample: id=${m.info?.marketId}, active=${m.active}, type=${m.info?.marketType}, outcomes=${m.outcomes?.length}`);
      });

      // Filter for active binary markets
      const binaryMarkets = rows.filter((x: any) => x.active && x.info?.marketType === 'binary');
      console.log(`[SomniaDreamDexAdapter] Filtered to ${binaryMarkets.length} active binary markets`);

      if (binaryMarkets.length === 0) {
        console.warn('[SomniaDreamDexAdapter] No active binary markets found. Returning first 10 markets regardless of filter:');
        // Fallback: return first 10 markets for testing, with logging
        return rows.slice(0, 10).map((x: any, idx: number) => {
          const i = x.info || {};
          const up = x.outcomes?.[0];
          const down = x.outcomes?.[1];
          const upPrice = Number(up?.price ?? 0.5);
          console.log(`[SomniaDreamDexAdapter] Fallback market ${idx}: ${i.marketId || 'unknown'}, active=${x.active}, type=${i.marketType}`);
          return {
            id: String(i.marketId || `market-${idx}`),
            marketId: String(i.marketId || `market-${idx}`),
            symbol: String(up?.symbol ?? x.symbol ?? i.marketId ?? `M${idx}`),
            asset: String(i.symbol ?? x.base ?? 'BTC').toUpperCase().startsWith('ETH') ? 'ETH' : 'BTC',
            intervalSeconds: Number(i.intervalSeconds ?? 900),
            openPrice: Number(i.openPrice ?? 0),
            currentPrice: Number(i.currentPrice ?? i.markPrice ?? upPrice),
            expiry: Number(i.expiryTimestampMs ?? i.expiry ?? Date.now() + 86400000),
            status: 'TRADING',
            upPrice,
            downPrice: Number(down?.price ?? (1 - upPrice)),
            liquidity: Number(x.info?.liquidity ?? 0),
            spread: 0,
          } as Market;
        });
      }

      // Map filtered markets to Market type
      const markets = binaryMarkets.map((x: any) => {
        const i = x.info;
        const up = x.outcomes?.[0];
        const down = x.outcomes?.[1];
        const upPrice = Number(up?.price ?? 0);
        return {
          id: String(i.marketId),
          marketId: String(i.marketId),
          symbol: String(up?.symbol ?? x.symbol ?? i.marketId),
          asset: String(i.symbol ?? x.base ?? 'BTC').toUpperCase().startsWith('ETH') ? 'ETH' : 'BTC',
          intervalSeconds: Number(i.intervalSeconds ?? 900),
          openPrice: Number(i.openPrice ?? 0),
          currentPrice: Number(i.currentPrice ?? i.markPrice ?? 0),
          expiry: Number(i.expiryTimestampMs ?? i.expiry ?? Date.now()),
          status: 'TRADING',
          upPrice,
          downPrice: Number(down?.price ?? (1 - upPrice)),
          liquidity: Number(x.info?.liquidity ?? 0),
          spread: 0,
        } as Market;
      });

      console.log(`[SomniaDreamDexAdapter] Returning ${markets.length} markets`);
      return markets;
    } catch (error) {
      console.error('[SomniaDreamDexAdapter] discoverMarkets error:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async orderBook(marketId: string): Promise<OrderBook> {
    try {
      const markets = await this.exchange.loadMarkets(true);
      const m = Object.values(markets).find((x: any) => String(x.info?.marketId) === marketId) as any;
      
      if (!m?.outcomes?.[0]?.symbol) {
        console.warn(`[SomniaDreamDexAdapter] Market ${marketId} not found for orderbook`);
        return { bids: [], asks: [] };
      }

      const b = await this.exchange.fetchOrderBook(m.outcomes[0].symbol, 10);
      return {
        bids: (b.bids ?? []).map((x: any) => ({ price: Number(x[0]), quantity: Number(x[1]) })),
        asks: (b.asks ?? []).map((x: any) => ({ price: Number(x[0]), quantity: Number(x[1]) })),
      };
    } catch (error) {
      console.error(`[SomniaDreamDexAdapter] orderBook error for ${marketId}:`, error instanceof Error ? error.message : String(error));
      return { bids: [], asks: [] };
    }
  }

  async execute(input: {
    marketId: string;
    side: Side;
    quantity: number;
    maxPrice: number;
    wallet: string;
  }): Promise<Trade> {
    try {
      const markets = await this.exchange.loadMarkets(true);
      const m = Object.values(markets).find((x: any) => String(x.info?.marketId) === input.marketId) as any;

      if (!m) throw new Error('Market not found');

      const onchain = await this.exchange.client.getMarketOnchain(input.marketId as `0x${string}`);
      if (onchain.status !== 1) throw new Error(`Market is not Trading (status ${onchain.status})`);

      const symbol = input.side === 'UP' ? m.outcomes[0].symbol : m.outcomes[1].symbol;
      const result = await this.exchange.createOrder(symbol, 'limit', 'buy', input.quantity, input.maxPrice, {
        timeInForce: 'IOC',
      });

      const receipt = (result.info as any)?.receipt;
      return {
        id: String(result.id ?? Date.now()),
        marketId: input.marketId,
        wallet: input.wallet,
        side: input.side,
        quantity: input.quantity,
        entryPrice: input.maxPrice,
        executionPrice: input.maxPrice,
        cost: input.maxPrice * input.quantity,
        payout: input.quantity,
        pnl: 0,
        status: 'OPEN',
        txHash: String(receipt?.transactionHash ?? ''),
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('[SomniaDreamDexAdapter] execute error:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  listTrades(): Trade[] {
    try {
      return this.exchange.listTrades?.() ?? [];
    } catch (error) {
      console.warn('[SomniaDreamDexAdapter] listTrades not available:', error instanceof Error ? error.message : String(error));
      return [];
    }
  }
}

