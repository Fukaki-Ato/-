import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createViteServer } from 'vite';
import { fileURLToPath } from 'node:url';

test('default-base Vite proxy rewrites request AND Cookie paths for persistent identities', async t => {
  const paths = [];
  const upstream = createHttpServer((req, res) => {
    paths.push(req.url);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/thunder-run/api/leaderboard') {
      res.setHeader('Set-Cookie', 'tr_lb=test-identity; Path=/thunder-run/api; HttpOnly; SameSite=Lax');
      res.end('{}');
    } else {
      assert.equal(req.headers.cookie, 'tr_lb=test-identity');
      res.end('{"accepted":true}');
    }
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => upstream.close(resolve)));
  const target = `http://127.0.0.1:${upstream.address().port}`;
  const vite = await createViteServer({
    configFile: fileURLToPath(new URL('../apps/web/vite.config.ts', import.meta.url)),
    root: fileURLToPath(new URL('../apps/web', import.meta.url)), base: '/', logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { port: 0, host: '127.0.0.1', open: false, watch: null, proxy: { '/api/': { target } } },
  });
  t.after(() => vite.close());
  await vite.listen();
  const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const response = await fetch(`${base}/api/leaderboard`);
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /Path=\/api(?:;|$)/);
  assert.doesNotMatch(cookie, /Path=\/thunder-run\/api/);
  const submitted = await fetch(`${base}/api/runs/submit`, {
    method: 'POST', headers: { Cookie: cookie.split(';')[0], 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.deepEqual(await submitted.json(), { accepted: true });
  assert.deepEqual(paths, ['/thunder-run/api/leaderboard', '/thunder-run/api/runs/submit']);
});
