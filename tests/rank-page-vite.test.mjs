import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer, preview } from 'vite';
import { createLeaderboardServer } from '../server/index.mjs';

const root=fileURLToPath(new URL('../apps/web/',import.meta.url)),origin='http://127.0.0.1:8767';
const meta=text=>/name="tr-rank-page" content="([A-Za-z0-9_-]{43})"/.exec(text)?.[1]??null;
async function setup(t) {
  const dir=await mkdtemp(join(tmpdir(),'tr-vite-gate-')),out=join(dir,'web');await mkdir(out);
  await writeFile(join(out,'index.html'),'<html><head><title>Preview</title></head><body>Preview</body></html>');
  const api=await createLeaderboardServer({dbPath:join(dir,'scores.sqlite'),webRoot:out,origins:[origin],workerCount:1});await api.listen(0);
  const closers=[()=>api.close()];
  const target=`http://127.0.0.1:${api.server.address().port}`;
  t.after(async()=>{for(const close of [...closers].reverse())await close();await rm(dir,{recursive:true,force:true});});
  return {api,dir,out,target,track:close=>closers.push(close)};
}

test('default-base dev HTML gets server credential and correctly scoped cookie without losing HMR',async t=>{
  const {api,target,out,track}=await setup(t);
  const vite=await createViteServer({configFile:join(root,'vite.config.ts'),root:out,base:'/',logLevel:'silent',
    optimizeDeps:{noDiscovery:true,include:[]},server:{host:'127.0.0.1',port:0,open:false,watch:null,preTransformRequests:false,
      proxy:{'/api/':{target},'/thunder-run/api/':{target}}}});
  track(()=>vite.close());await vite.listen();const base=`http://127.0.0.1:${vite.httpServer.address().port}`;
  const entry=await fetch(base+'/');assert.equal(entry.status,200);const html=await entry.text();const pageId=meta(html);assert.ok(pageId);
  assert.ok(html.includes('/@vite/client'),'HMR injection survives');
  const raw=entry.headers.getSetCookie().find(v=>v.startsWith('tr_rank_session='));assert.ok(raw?.includes('Path=/;'));
  const cookie=raw.split(';')[0];
  const begin=await fetch(base+'/api/runs',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({charId:'char_volt',rulesId:api.expectedRulesId,pageId})});
  assert.equal(begin.status,201);
  const debug=await fetch(base+'/?%64ebug=0',{headers:{Cookie:cookie}});assert.equal(debug.status,200,'local dev still renders QA');
  assert.equal(meta(await debug.text()),null,'QA has no ranking page capability');
  const revoked=await fetch(base+'/api/runs',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({charId:'char_volt',rulesId:api.expectedRulesId,pageId})});assert.equal(revoked.status,403);
  assert.equal((await fetch(base+'/@vite/client')).status,200,'HMR modules are not gated');
});

test('production preview proxies page authorization, rejects QA, and does not gate assets',async t=>{
  const {api,target,out,track}=await setup(t);
  const web=await preview({configFile:join(root,'vite.config.ts'),root,base:'/thunder-run/',logLevel:'silent',
    build:{outDir:out},preview:{host:'127.0.0.1',port:0,open:false,proxy:{'/thunder-run/api/':{target}}}});
  track(()=>web.close());
  const base=`http://127.0.0.1:${web.httpServer.address().port}`;
  const entry=await fetch(base+'/thunder-run/');assert.equal(entry.status,200);const pageId=meta(await entry.text());assert.ok(pageId);
  const raw=entry.headers.getSetCookie().find(v=>v.startsWith('tr_rank_session='));assert.ok(raw?.includes('Path=/thunder-run/;'));
  const cookie=raw.split(';')[0];
  const begin=await fetch(base+'/thunder-run/api/runs',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({charId:'char_volt',rulesId:api.expectedRulesId,pageId})});assert.equal(begin.status,201);
  const debug=await fetch(base+'/thunder-run/?TEST=false',{headers:{Cookie:cookie}});assert.equal(debug.status,403);
  const revoked=await fetch(base+'/thunder-run/api/runs',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({charId:'char_volt',rulesId:api.expectedRulesId,pageId})});assert.equal(revoked.status,403);
});
