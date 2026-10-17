import { createMissionHttpServer } from './http.mjs';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 8768);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 0 to 65535');

const app = createMissionHttpServer();
app.server.on('error', error => {
  console.error('mission server failed to start:', error);
  app.close().finally(() => process.exit(1));
});
app.server.listen(port, host, () => {
  const address = app.server.address();
  console.log(`Mission API listening at http://${host}:${address.port}`);
});

let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    app.close().finally(() => process.exit(0));
  });
}
