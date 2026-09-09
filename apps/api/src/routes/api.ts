import type { FastifyInstance } from 'fastify';
import { detail, execute, preview, snapshot, trades, isLiveMode, getAdapterStatus } from '../services/marketService.js';
import { createMarketStream, getMarketStreamStatus } from '../services/liveMarketService.js';

export async function apiRoutes(app: FastifyInstance) {
  // Health check - shows if running in demo or live mode
  app.get('/health', async () => ({
    ok: true,
    service: 'eventlens-api',
    mode: isLiveMode() ? 'live' : 'demo',
    timestamp: new Date().toISOString(),
    adapter: getAdapterStatus(),
    stream: getMarketStreamStatus(),
    dreamdex: isLiveMode()
      ? {
          connected: true,
          network: process.env.SOMNIA_NETWORK || 'shannon',
          indexer: process.env.SOMNIA_INDEXER_URL ? 'configured' : 'not-configured',
          wsRpc: process.env.SOMNIA_WS_RPC_URL ? 'configured' : 'not-configured',
        }
      : {
          connected: false,
          message: 'Set DEMO_MODE=false to enable DREAMDEX testnet',
        },
  }));

  // REST endpoints
  app.get('/markets', async () => snapshot());

  app.get('/markets/:id', async (req: any) => {
    try {
      return await detail(req.params.id);
    } catch (error) {
      app.log.error('Error fetching market detail:', error);
      return {
        error: error instanceof Error ? error.message : 'Failed to fetch market',
        statusCode: 500,
      };
    }
  });

  app.get('/positions', async () => trades());

  app.get('/trades', async () => trades());

  app.post('/trades/preview', async (req: any) => {
    try {
      return await preview(req.body);
    } catch (error) {
      app.log.error('Error previewing trade:', error);
      return {
        ok: false,
        reasons: [error instanceof Error ? error.message : 'Preview failed'],
        checks: [],
      };
    }
  });

  app.post('/trades/execute', async (req: any) => {
    try {
      return await execute(req.body);
    } catch (error) {
      app.log.error('Error executing trade:', error);
      return {
        ok: false,
        reasons: [error instanceof Error ? error.message : 'Execution failed'],
        checks: [],
      };
    }
  });

  app.post('/explain', async (req: any) => ({
    text: `EventLens sees a ${(Math.abs(req.body.edge || 0) * 100).toFixed(1)} percentage-point dislocation. The explanation is derived from the deterministic signal inputs; AI is intentionally not allowed to override execution or risk gates.`,
  }));

  // WebSocket endpoint for live market streaming
  app.get('/ws/markets', { websocket: true }, async (socket, req) => {
    const clientId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    app.log.info(`[${clientId}] Client connected to market stream`);

    if (!isLiveMode()) {
      try {
        socket.send(
          JSON.stringify({
            type: 'info',
            mode: 'demo',
            message: 'Running in DEMO mode. Set DEMO_MODE=false in environment to connect DREAMDEX testnet.',
            timestamp: Date.now(),
          })
        );
      } catch (error) {
        app.log.error(`[${clientId}] Error sending demo mode message:`, error);
      }
      socket.close(1008, 'Demo mode: DREAMDEX not enabled');
      return;
    }

    try {
      const stream = createMarketStream({
        pollIntervalMs: 2000,
        minIntervalMs: 500,
      });

      const unsubscribe = stream.subscribe((markets) => {
        if (socket.readyState === socket.OPEN) {
          try {
            socket.send(
              JSON.stringify({
                type: 'markets',
                timestamp: Date.now(),
                count: markets.length,
                markets:
                  markets.length > 0
                    ? markets.map(m => ({
                        id: m.id,
                        marketId: m.marketId,
                        symbol: m.symbol,
                        asset: m.asset,
                        currentPrice: m.currentPrice,
                        upPrice: m.upPrice,
                        downPrice: m.downPrice,
                        liquidity: m.liquidity,
                        status: m.status,
                        expiry: m.expiry,
                      }))
                    : [],
              })
            );
          } catch (error) {
            app.log.warn(`[${clientId}] Error sending market data:`, error instanceof Error ? error.message : String(error));
          }
        }
      }, clientId);

      socket.on('close', () => {
        app.log.info(`[${clientId}] Client disconnected`);
        unsubscribe();
      });

      socket.on('error', (error) => {
        app.log.error(`[${clientId}] WebSocket error:`, error);
        unsubscribe();
      });

      // Send initial connection confirmation
      socket.send(
        JSON.stringify({
          type: 'connected',
          clientId,
          mode: 'live',
          network: process.env.SOMNIA_NETWORK || 'shannon',
          timestamp: Date.now(),
        })
      );
    } catch (error) {
      app.log.error(`[${clientId}] Error setting up market stream:`, error);
      try {
        socket.send(
          JSON.stringify({
            type: 'error',
            message: error instanceof Error ? error.message : 'Failed to initialize stream',
            timestamp: Date.now(),
          })
        );
      } catch (sendError) {
        app.log.error(`[${clientId}] Error sending error message:`, sendError);
      }
      socket.close(1011, 'Internal server error');
    }
  });

  // Stream status endpoint
  app.get('/stream/status', async () => {
    return {
      status: getMarketStreamStatus(),
      adapterStatus: getAdapterStatus(),
      timestamp: new Date().toISOString(),
    };
  });
}

