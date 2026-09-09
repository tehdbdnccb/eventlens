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
  private lastError: Error | null = null;

  constructor(config: SomniaConfig) {
    this.config = config;
    console.log(`[SomniaDreamDexAdapter] Constructor called with:`, {
      network: config.network,
      indexerUrl: config.indexerUrl.substring(0, 50) + '...',
      wsRpcUrl: config.wsRpcUrl.substring(0, 50) + '...',
      hasPrivateKey: !!config.privateKey,
    });

    try {
      const isMainnet = config.network === 'mainnet';
      const chainConfig = isMainnet ? somniaMainnet : somniaShannon;
      const addresses = isMainnet ? SOMNIA_MAINNET_ADDRESSES : SOMNIA_TESTNET_ADDRESSES;
      
      console.log(`[SomniaDreamDexAdapter] Initializing SomniaMarkets with chain=${config.network}`);
      
      this.exchange = new SomniaMarkets({
        indexerUrl: config.indexerUrl,
        wsRpcUrl: config.wsRpcUrl,
        chain: chainConfig,
        addresses: addresses,
        ...(config.privateKey ? { privateKey: config.privateKey } : {}),
      });
      
      console.log(`[SomniaDreamDexAdapter] SomniaMarkets instance created successfully`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[SomniaDreamDexAdapter] Constructor error:`, msg, error);
      this.lastError = error instanceof Error ? error : new Error(msg);
      throw error;
    }
  }

  async discoverMarkets(): Promise<Market[]> {
    console.log(`[SomniaDreamDexAdapter] discoverMarkets() called`);
    
    try {
      // Verify exchange object exists
      if (!this.exchange) {
        throw new Error('Exchange not initialized');
      }

      console.log(`[SomniaDreamDexAdapter] Calling loadMarkets(true)...`);
      const startTime = Date.now();
      
      let rawMarkets: any;
      try {
        rawMarkets = await this.exchange.loadMarkets(true);
        const duration = Date.now() - startTime;
        console.log(`[SomniaDreamDexAdapter] loadMarkets completed in ${duration}ms, type: ${typeof rawMarkets}`);
      } catch (loadError) {
        const msg = loadError instanceof Error ? loadError.message : String(loadError);
        console.error(`[SomniaDreamDexAdapter] loadMarkets threw error:`, msg);
        throw new Error(`loadMarkets failed: ${msg}`);
      }

      // Validate response
      if (!rawMarkets) {
        console.warn(`[SomniaDreamDexAdapter] loadMarkets returned null/undefined`);
        return [];
      }

      if (typeof rawMarkets !== 'object') {
        console.warn(`[SomniaDreamDexAdapter] loadMarkets returned invalid type: ${typeof rawMarkets}`);
        return [];
      }

      const rows = Object.values(rawMarkets) as any[];
      console.log(`[SomniaDreamDexAdapter] Loaded ${rows.length} total markets, keys: ${Object.keys(rawMarkets).slice(0, 5).join(',')}`);

      if (rows.length === 0) {
        console.warn(`[SomniaDreamDexAdapter] No markets returned from loadMarkets`);
        return [];
      }

      // Log detailed sample of first market
      if (rows.length > 0) {
        const sample = rows[0];
        console.log(`[SomniaDreamDexAdapter] First market structure:`, {
          hasInfo: !!sample.info,
          hasOutcomes: !!sample.outcomes,
          hasActive: 'active' in sample,
          active: sample.active,
          marketType: sample.info?.marketType,
          marketId: sample.info?.marketId,
          symbol: sample.symbol,
          outcomesLength: sample.outcomes?.length,
        });

        // Log first 3 markets
        rows.slice(0, 3).forEach((m: any, i: number) => {
          console.log(`[SomniaDreamDexAdapter] Market ${i}: id=${m.info?.marketId}, active=${m.active}, type=${m.info?.marketType}`);
        });
      }

      // Try binary filter
      console.log(`[SomniaDreamDexAdapter] Filtering for active binary markets...`);
      const binaryMarkets = rows.filter((x: any) => {
        const active = x.active === true;
        const isBinary = x.info?.marketType === 'binary';
        return active && isBinary;
      });
      
      console.log(`[SomniaDreamDexAdapter] Binary filter result: ${binaryMarkets.length} markets (from ${rows.length} total)`);

      // If no binary markets, try alternative filters
      if (binaryMarkets.length === 0) {
        console.warn(`[SomniaDreamDexAdapter] No active binary markets. Trying fallback filters...`);
        
        const activeOnly = rows.filter((x: any) => x.active === true);
        console.log(`[SomniaDreamDexAdapter] Active markets (any type): ${activeOnly.length}`);
        
        const binaryOnly = rows.filter((x: any) => x.info?.marketType === 'binary');
        console.log(`[SomniaDreamDexAdapter] Binary markets (any status): ${binaryOnly.length}`);
        
        // Use whichever has more data
        let fallbackMarkets = activeOnly.length > 0 ? activeOnly : binaryOnly;
        if (fallbackMarkets.length === 0) {
          fallbackMarkets = rows;
        }

        console.log(`[SomniaDreamDexAdapter] Using fallback: ${fallbackMarkets.length} markets`);
        
        return fallbackMarkets.slice(0, 20).map((x: any, idx: number) => {
          const i = x.info || {};
          const up = x.outcomes?.[0];
          const down = x.outcomes?.[1];
          const upPrice = Number(up?.price ?? 0.5);
          
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

      // Map binary markets to Market type
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

      console.log(`[SomniaDreamDexAdapter] Returning ${markets.length} binary markets`);
      return markets;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.lastError = error instanceof Error ? error : new Error(msg);
      console.error(`[SomniaDreamDexAdapter] discoverMarkets error:`, msg, error);
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
      console.error(`[SomniaDreamDexAdapter] orderBook error:`, error instanceof Error ? error.message : String(error));
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
      console.error(`[SomniaDreamDexAdapter] execute error:`, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  listTrades(): Trade[] {
    try {
      return this.exchange.listTrades?.() ?? [];
    } catch (error) {
      console.warn(`[SomniaDreamDexAdapter] listTrades unavailable:`, error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  getLastError(): Error | null {
    return this.lastError;
  }
}

