import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { apiRoutes } from './routes/api.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(websocket);
await apiRoutes(app);

const port = Number(process.env.API_PORT || 4000);
app.listen({ port, host: '0.0.0.0' }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});

