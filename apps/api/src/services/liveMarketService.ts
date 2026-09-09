import type { Market } from '@eventlens/shared';

interface StreamListener {
  id: string;
  callback: (markets: Market[]) => void;
  lastSentAt: number;
}

interface StreamConfig {
  pollIntervalMs: number;
  minIntervalMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  staleDataThresholdMs: number;
}

const DEFAULT_CONFIG: StreamConfig = {
  pollIntervalMs: 2000, // Poll every 2 seconds
  minIntervalMs: 500, // Don't send updates faster than this
  maxRetries: 3,
  retryBackoffMs: 1000,
  staleDataThresholdMs: 30000, // Warn if data older than 30s
};

class MarketStream {
  private listeners: Map<string, StreamListener> = new Map();
  private pollInterval: NodeJS.Timeout | null = null;
  private lastData: Market[] = [];
  private lastFetchTime = 0;
  private consecutiveFetchErrors = 0;
  private isRunning = false;
  private retryTimeouts: Set<NodeJS.Timeout> = new Set();
  private config: StreamConfig;

  constructor(config: Partial<StreamConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  subscribe(listener: (markets: Market[]) => void, listenerId?: string): () => void {
    const id = listenerId || `listener-${Date.now()}-${Math.random()}`;
    const entry: StreamListener = {
      id,
      callback: listener,
      lastSentAt: 0,
    };
    this.listeners.set(id, entry);

    if (!this.isRunning) {
      this.start();
    }

    console.log(`[MarketStream] Listener subscribed: ${id} (total: ${this.listeners.size})`);

    return () => this.unsubscribe(id);
  }

  private unsubscribe(id: string) {
    this.listeners.delete(id);
    console.log(`[MarketStream] Listener unsubscribed: ${id} (remaining: ${this.listeners.size})`);

    if (this.listeners.size === 0) {
      this.stop();
    }
  }

  private start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.consecutiveFetchErrors = 0;
    console.log('[MarketStream] Starting market stream polling');

    this.pollInterval = setInterval(() => this.poll(), this.config.pollIntervalMs);
    // Initial poll immediately
    this.poll();
  }

  private async poll() {
    if (this.consecutiveFetchErrors >= this.config.maxRetries) {
      console.error(
        `[MarketStream] Max retries (${this.config.maxRetries}) exceeded, stopping stream`
      );
      this.stop();
      return;
    }

    try {
      const { getMarketsWithCache } = await import('./marketService.js');
      const markets = await getMarketsWithCache();

      this.lastFetchTime = Date.now();
      this.consecutiveFetchErrors = 0;

      // Check if data is stale
      if (Date.now() - this.lastFetchTime > this.config.staleDataThresholdMs) {
        console.warn('[MarketStream] Market data is stale');
      }

      // Only broadcast if data changed
      if (JSON.stringify(this.lastData) !== JSON.stringify(markets)) {
        this.lastData = markets;
        this.broadcast(markets);
      }
    } catch (error) {
      this.consecutiveFetchErrors++;
      const backoff = this.config.retryBackoffMs * Math.pow(2, this.consecutiveFetchErrors - 1);

      console.error(
        `[MarketStream] Poll error (${this.consecutiveFetchErrors}/${this.config.maxRetries}):`,
        error instanceof Error ? error.message : String(error),
        `Backoff: ${backoff}ms`
      );

      // Broadcast error to all listeners
      this.broadcastError(error instanceof Error ? error.message : String(error));

      // Schedule retry with exponential backoff
      if (this.consecutiveFetchErrors < this.config.maxRetries) {
        const timeout = setTimeout(() => {
          this.retryTimeouts.delete(timeout);
          this.poll();
        }, backoff);
        this.retryTimeouts.add(timeout);
      }
    }
  }

  private broadcast(markets: Market[]) {
    const now = Date.now();
    let broadcastCount = 0;

    this.listeners.forEach(listener => {
      // Rate limit: don't send to same listener faster than minIntervalMs
      if (now - listener.lastSentAt < this.config.minIntervalMs) {
        return;
      }

      try {
        listener.callback(markets);
        listener.lastSentAt = now;
        broadcastCount++;
      } catch (error) {
        console.error(`[MarketStream] Error notifying listener ${listener.id}:`, error);
      }
    });

    if (broadcastCount > 0) {
      console.log(`[MarketStream] Broadcast to ${broadcastCount}/${this.listeners.size} listeners`);
    }
  }

  private broadcastError(message: string) {
    this.listeners.forEach(listener => {
      try {
        listener.callback([]);
      } catch (error) {
        console.error(`[MarketStream] Error notifying listener of error ${listener.id}:`, error);
      }
    });
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.retryTimeouts.forEach(timeout => clearTimeout(timeout));
    this.retryTimeouts.clear();

    console.log('[MarketStream] Market stream stopped');
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      listenerCount: this.listeners.size,
      lastFetchTime: new Date(this.lastFetchTime).toISOString(),
      consecutiveErrors: this.consecutiveFetchErrors,
      lastDataLength: this.lastData.length,
      config: this.config,
    };
  }
}

// Singleton instance
let globalStream: MarketStream | null = null;

export function createMarketStream(config?: Partial<StreamConfig>): MarketStream {
  if (!globalStream) {
    globalStream = new MarketStream(config);
  }
  return globalStream;
}

export function getMarketStreamStatus() {
  return globalStream?.getStatus() || { isRunning: false, listenerCount: 0 };
}

export function stopGlobalStream() {
  if (globalStream) {
    globalStream.stop();
    globalStream = null;
  }
}

