import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { createServer as viteServer } from 'vite';
import { fileURLToPath } from 'node:url';

test('mission routes precede the leaderboard catch-all proxy without rewriting mission cookies or paths', async t => {
  const received = [];
  const start = async name => {
    const server = httpServer((req, res) => {
      received.push([name, req.url]);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Set-Cookie', name === 'missions' ? 'tr_mission_session=fixture; Path=/; HttpOnly'
        : 'tr_lb=fixture; Path=/thunder-run/api; HttpOnly');
      res.end(JSON.stringify({ name }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}`;
  };
  const missionTarget = await start('missions'), leaderboardTarget = await start('leaderboard');
  const vite = await viteServer({
    configFile: fileURLToPath(new URL('../apps/web/vite.config.ts', import.meta.url)),
    root: fileURLToPath(new URL('../apps/web', import.meta.url)), base: '/', logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { port: 0, host: '127.0.0.1', open: false, watch: null,
      proxy: { '/api/missions': { target: missionTarget }, '/api/': { target: leaderboardTarget } } },
  });
  t.after(() => vite.close()); await vite.listen();
  const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const mission = await fetch(base + '/api/missions/session', { method: 'POST' });
  assert.deepEqual(await mission.json(), { name: 'missions' });
  assert.match(mission.headers.get('set-cookie'), /Path=\/(?:;|$)/);
  const ranking = await fetch(base + '/api/leaderboard');
  assert.deepEqual(await ranking.json(), { name: 'leaderboard' });
  assert.match(ranking.headers.get('set-cookie'), /Path=\/api(?:;|$)/);
  assert.deepEqual(received, [['missions', '/api/missions/session'], ['leaderboard', '/thunder-run/api/leaderboard']]);
});
