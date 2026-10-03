import { defineConfig, type Plugin } from 'vite';
import { readFile, cp, mkdir } from 'node:fs/promises';
import { join, normalize, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Vite setup for the Web app: config is public and runtime assets are copied to dist. */
const assetsDir = fileURLToPath(new URL('../../assets', import.meta.url));
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  // 音频：dev 中间件按真实 MIME 下发，避免 <audio> 依赖嗅探
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  // 大厅背景循环视频：<video> 对 octet-stream 直接拒绝解码，MIME 必须给对
  '.mp4': 'video/mp4',
};

function trAssets(): Plugin {
  let outDir = '';
  let isBuild = false;
  return {
    name: 'tr-assets',
    configResolved(cfg) {
      outDir = resolve(cfg.root, cfg.build.outDir);
      isBuild = cfg.command === 'build';
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0] ?? '';
        if (!url.startsWith('/assets/')) return next();
        const p = normalize(join(assetsDir, decodeURIComponent(url.slice('/assets/'.length))));
        if (!p.startsWith(assetsDir)) { res.statusCode = 403; res.end('forbidden'); return; }
        readFile(p)
          .then(buf => {
            res.setHeader('Content-Type', MIME[extname(p).toLowerCase()] ?? 'application/octet-stream');
            res.setHeader('Cache-Control', 'no-store');
            res.end(buf);
          })
          .catch(() => { res.statusCode = 404; res.end('not found'); });
      });
    },
    async closeBundle() {
      if (!isBuild) return;
      await mkdir(join(outDir, 'assets'), { recursive: true });
      await cp(assetsDir, join(outDir, 'assets'), { recursive: true });
    },
  };
}

export default defineConfig({
  publicDir: '../../config',
  plugins: [trAssets()],
  server: {
    host: '127.0.0.1',
    port: 8767,
    strictPort: true,
    // TR_NO_OPEN=1：CI/自动化冒烟时不弹浏览器（人双击 .bat 时照旧自动打开）
    open: !process.env.TR_NO_OPEN,
  },
  optimizeDeps: {
    include: ['three'],
  },
  build: {
    target: 'es2021',
    sourcemap: true,
  },
});
