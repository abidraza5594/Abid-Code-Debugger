import { config, aiAvailable } from './config.js';
import { aiClient } from './ai/client.js';
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
  `AI provider=${aiClient.provider()} ${aiAvailable() ? 'enabled' : 'disabled (heuristic fallback)'} - root-cause=${rootCauseModel()}, fix=${fixModel()}`,
);

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

function rootCauseModel(): string {
  return config.ai.provider === 'ollama'
    ? config.ollama.rootCauseModel
    : config.mistral.rootCauseModel;
}

function fixModel(): string {
  return config.ai.provider === 'ollama' ? config.ollama.fixModel : config.mistral.fixModel;
}
