import type { FastifyInstance } from 'fastify';
import { detail, execute, preview, snapshot, trades, isLiveMode, getAdapterStatus } from '../services/marketService.js';
import { createMarketStream, getMarketStreamStatus } from '../services/liveMarketService.js';

export async function apiRoutes(app: FastifyInstance) {
  // Health check
  app.get('/health', async () => ({
    ok: true,
    service: 'eventlens-api',
    timestamp: new Date().toISOString(),
    adapter: getAdapterStatus(),
    stream: getMarketStreamStatus(),
    note: process.env.USE_SYNTHETIC === 'true' 
      ? 'Running with SYNTHETIC hardcoded binary market data' 
      : 'Set USE_SYNTHETIC=true for synthetic markets, DEMO_MODE=true for demo, or configure Somnia for live',
  }));

  // REST endpoints
  app.get('/markets', async () => snapshot());

  app.get('/markets/:id', async (req: any) => {
    try {
      return await detail(req.params.id);
    } catch (error) {
      app.log.error({ err: error }, 'Error fetching market detail:');
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
      app.log.error({ err: error }, 'Error previewing trade:');
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
      app.log.error({ err: error }, 'Error executing trade:');
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
            message: 'EventLens API not in live mode. Set USE_SYNTHETIC=true, DEMO_MODE=true, or configure Somnia.',
            timestamp: Date.now(),
          })
        );
      } catch (error) {
        app.log.error({ err: error }, `[${clientId}] Error sending info:`);
      }
      socket.close(1008, 'Live mode not enabled');
      return;
    }

    try {
      const stream = createMarketStream({
        pollIntervalMs: process.env.USE_SYNTHETIC === 'true' ? 1000 : 2000,
        minIntervalMs: 300,
      });

      const unsubscribe = stream.subscribe((markets) => {
        if (socket.readyState === socket.OPEN) {
          try {
            socket.send(
              JSON.stringify({
                type: 'markets',
                timestamp: Date.now(),
                count: markets.length,
                mode: getAdapterStatus().mode,
                markets:
                  markets.length > 0
                    ? markets.map(m => ({
                        id: m.id,
                        marketId: m.marketId,
                        symbol: m.symbol,
                        asset: m.asset,
                        currentPrice: Number(m.currentPrice.toFixed(4)),
                        upPrice: Number(m.upPrice.toFixed(4)),
                        downPrice: Number(m.downPrice.toFixed(4)),
                        liquidity: m.liquidity,
                        status: m.status,
                        expiry: m.expiry,
                      }))
                    : [],
              })
            );
          } catch (error) {
            app.log.warn({ err: error }, `[${clientId}] Error sending market data:`);
          }
        }
      }, clientId);

      socket.on('close', () => {
        app.log.info(`[${clientId}] Client disconnected`);
        unsubscribe();
      });

      socket.on('error', (error: Error) => {
        app.log.error({ err: error }, `[${clientId}] WebSocket error:`);
        unsubscribe();
      });

      // Send connection confirmation
      socket.send(
        JSON.stringify({
          type: 'connected',
          clientId,
          mode: getAdapterStatus().mode,
          timestamp: Date.now(),
        })
      );
    } catch (error) {
      app.log.error({ err: error }, `[${clientId}] Error setting up market stream:`);
      try {
        socket.send(
          JSON.stringify({
            type: 'error',
            message: error instanceof Error ? error.message : 'Failed to initialize stream',
            timestamp: Date.now(),
          })
        );
      } catch (sendError) {
        app.log.error({ err: sendError }, `[${clientId}] Error sending error message:`);
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

