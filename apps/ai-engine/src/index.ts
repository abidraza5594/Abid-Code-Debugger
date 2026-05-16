/**
 * AI engine entry point. Boots the HTTP server and the WebSocket server, both bound to the
 * loopback interface by default. Designed to run as `node dist/index.js`.
 */

import { config, aiAvailable } from './config.js';
import { buildHttpApp } from './server/http.js';
import { EngineWebSocketServer } from './server/websocket.js';
import { createLogger } from './logger.js';

const log = createLogger('engine');

const httpApp = buildHttpApp();
httpApp.listen(config.http.port, '127.0.0.1', () => {
  log('info', `HTTP listening on http://127.0.0.1:${config.http.port}`);
});

new EngineWebSocketServer(log);

log(
  'info',
  `Mistral AI ${aiAvailable() ? 'enabled' : 'disabled (heuristic fallback)'} — root-cause=${config.mistral.rootCauseModel}, fix=${config.mistral.fixModel}`,
);

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
