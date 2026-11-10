import 'dotenv/config';
import { createServer } from 'node:http';
import { Server as IOServer } from 'socket.io';
import { env } from './config/env.js';
import { buildApp } from './app.js';
import { logger } from './lib/logger.js';
import { attachSockets } from './sockets/index.js';

const app = buildApp();
const http = createServer(app);
const io = new IOServer(http, {
  cors: { origin: env.FRONTEND_ORIGIN, credentials: true },
});
attachSockets(io);

const server = http.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'FlatFit API listening');
});

function shutdown(sig: string) {
  logger.info({ sig }, 'graceful shutdown');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
