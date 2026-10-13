import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLeaderboardServer, API_PATH } from '../server/index.mjs';
import { loadContent } from '../tools/replay/runner.mjs';

const ORIGIN = 'https://game.example.test', content = loadContent();
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'tr-debug-gate-')), webRoot = join(dir, 'web');
  await mkdir(webRoot); await writeFile(join(webRoot, 'index.html'), '<!doctype html><html><head><title>Game</title></head><body>Game</body></html>');
  const service = await createLeaderboardServer({ content, webRoot, dbPath: join(dir, 'scores.sqlite'), origins: [ORIGIN], workerCount: 1, ...options });
  await service.listen(0);
  t.after(async () => {
    // A failed race assertion must not leave the deliberately blocked worker/request hanging.
    await options.replayPool?.close();
    await service.close(); await rm(dir, {recursive:true,force:true});
  });
  return { service, base: `http://127.0.0.1:${service.server.address().port}` };
}
class Browser {
  constructor(base) { this.base = base; this.jar = new Map(); this.pageId = null; }
  async request(path, { method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(this.base + path, { method, headers: {
      Origin: ORIGIN, Cookie: [...this.jar].map(([k,v])=>`${k}=${v}`).join('; '),
      ...(body ? {'Content-Type':'application/json'} : {}), ...headers,
    }, body: body ? JSON.stringify(body) : undefined });
    for(const value of response.headers.getSetCookie()) { const pair=value.split(';')[0], at=pair.indexOf('=');this.jar.set(pair.slice(0,at),pair.slice(at+1)); }
    const text = await response.text(); let data=null;try{data=JSON.parse(text);}catch{}
    return {response,data,text};
  }
  async enter(path='/thunder-run/', method='HEAD') {
    const result=await this.request(path,{method});
    this.pageId=result.response.headers.get('x-tr-rank-page') ?? /name="tr-rank-page" content="([A-Za-z0-9_-]{43})"/.exec(result.text)?.[1] ?? null;
    return result;
  }
  begin(rulesId, override={}) {return this.request(API_PATH+'/runs',{method:'POST',body:{charId:'char_volt',rulesId,pageId:this.pageId,...override}});}
  submit(runId, override={}) {return this.request(API_PATH+'/runs/submit',{method:'POST',body:{runId,frames:1,inputs:[],pageId:this.pageId,...override}});}
}

test('official entries reject encoded/mixed/repeated QA flags and revoke presented normal credentials', async t=>{
  const {service,base}=await fixture(t);const b=new Browser(base);
  const page=await b.enter('/thunder-run/','GET');assert.equal(page.response.status,200);assert.ok(b.pageId);
  assert.equal(page.response.headers.get('cache-control'),'no-store');assert.equal(page.response.headers.get('x-frame-options'),'DENY');
  assert.equal(page.response.headers.get('content-security-policy'),"frame-ancestors 'none'");
  const pageId=b.pageId;
  for(const path of ['/thunder-run/?debug=false','/thunder-run/index.html?%64ebug=0','/thunder-run/?TEST','/thunder-run/?x=1&TeSt=0&test=1','/thunder-run/?anim=Run','/thunder-run/?ui=demo']){
    const result=await b.request(path);assert.equal(result.response.status,403,path);
    assert.ok(!result.response.headers.get('x-tr-rank-page'));assert.ok(!result.text.includes('name="tr-rank-page"'));
  }
  assert.equal((await b.begin(service.expectedRulesId,{pageId})).response.status,403);
  assert.equal((await b.enter()).response.status,200);assert.ok(b.pageId&&b.pageId!==pageId);
  assert.equal((await b.begin(service.expectedRulesId)).response.status,201);
});

test('without cookie AND per-document credential, fake normal/debug fields cannot obtain a ranked ticket', async t=>{
  const {service,base}=await fixture(t);const a=new Browser(base),b=new Browser(base);
  assert.equal((await a.begin(service.expectedRulesId)).response.status,403);
  await a.enter();await b.enter();
  assert.equal((await b.begin(service.expectedRulesId,{pageId:a.pageId})).response.status,403);
  assert.equal((await a.begin(service.expectedRulesId,{pageId:'f'.repeat(43)})).response.status,403);
  assert.equal((await a.begin(service.expectedRulesId,{debug:false})).response.status,400);
  assert.equal((await a.begin(service.expectedRulesId,{mode:'normal'})).response.status,400);
});

test('a ticket is bound to its document, debug revokes it, and a fresh clean page cannot rescue it', async t=>{
  const {service,base}=await fixture(t);const b=new Browser(base);
  await b.enter();const first=b.pageId,ticket=(await b.begin(service.expectedRulesId)).data;
  await b.enter();assert.notEqual(b.pageId,first);
  assert.equal((await b.submit(ticket.runId)).response.status,403,'different normal document cannot submit this ticket');
  const t2=(await b.begin(service.expectedRulesId)).data;const prior=b.pageId;
  assert.equal((await b.request('/thunder-run/?debug')).response.status,403);
  assert.equal((await b.submit(t2.runId)).response.status,403);
  await b.enter();const fresh=b.pageId;assert.notEqual(fresh,prior);
  assert.equal((await b.begin(service.expectedRulesId,{pageId:prior})).response.status,403);
  assert.equal((await b.begin(service.expectedRulesId,{pageId:first})).response.status,403);
  assert.equal((await b.begin(service.expectedRulesId)).response.status,201);
});

test('debug referral/API query is a veto, never normal eligibility inferred from missing Referer',async t=>{
  const {service,base}=await fixture(t);const b=new Browser(base);await b.enter();
  const r=await b.request(API_PATH+'/runs',{method:'POST',body:{charId:'char_volt',rulesId:service.expectedRulesId,pageId:b.pageId},headers:{Referer:ORIGIN+'/thunder-run/index.html?TEST=0'}});
  assert.equal(r.response.status,403);assert.equal((await b.begin(service.expectedRulesId)).response.status,403);
  await b.enter();assert.equal((await b.request(API_PATH+'/health?debug')).response.status,403);
  assert.equal((await b.begin(service.expectedRulesId)).response.status,403);
});

test('local/test debug page can load but has no ranking document credential even after another tab enters normal',async t=>{
  const {service,base}=await fixture(t,{allowDebugPages:true});const b=new Browser(base);
  const debug=await b.enter('/thunder-run/?test','GET');assert.equal(debug.response.status,200);assert.equal(b.pageId,null);
  assert.equal((await b.begin(service.expectedRulesId)).response.status,403);
  await b.enter();const clean=b.pageId;
  assert.equal((await b.begin(service.expectedRulesId,{pageId:null})).response.status,403,'debug document does not inherit a normal document capability');
  assert.equal((await b.begin(service.expectedRulesId,{pageId:clean})).response.status,201);
});

test('an external site with a debug-looking referrer cannot revoke a normal session',async t=>{
  const {service,base}=await fixture(t);const b=new Browser(base);await b.enter();
  const response=await b.request(API_PATH+'/health',{headers:{Referer:'https://evil.example/thunder-run/?debug'}});
  assert.equal(response.response.status,200);
  assert.equal((await b.begin(service.expectedRulesId)).response.status,201);
});

test('revocation while replay awaits prevents SQL write even if the worker approves',async t=>{
  let start,finish;
  const running=new Promise(resolve=>{start=resolve;});
  const worker={run:()=>{start();return new Promise(resolve=>{finish=resolve;});},async close(){finish?.({accepted:false});}};
  const {service,base}=await fixture(t,{replayPool:worker});const b=new Browser(base);await b.enter();
  const ticket=(await b.begin(service.expectedRulesId)).data;
  const submission=b.submit(ticket.runId);await running;
  assert.equal((await b.request('/thunder-run/?debug')).response.status,403);
  finish({accepted:true,distance:123,score:1230});
  assert.equal((await submission).response.status,403);
  assert.deepEqual((await b.request(API_PATH+'/leaderboard')).data.entries,[]);
});

test('expiry while replay awaits also prevents write; rank capacity exhaustion remains unranked',async t=>{
  let clock=0,start,finish;const running=new Promise(resolve=>{start=resolve;});
  const worker={run:()=>{start();return new Promise(resolve=>{finish=resolve;});},async close(){finish?.({accepted:false});}};
  const {service,base}=await fixture(t,{replayPool:worker,pageSessionOptions:{now:()=>clock,ttlMs:100}});
  const b=new Browser(base);await b.enter();const ticket=(await b.begin(service.expectedRulesId)).data;
  const submission=b.submit(ticket.runId);await running;clock=101;finish({accepted:true,distance:123,score:1230});
  assert.equal((await submission).response.status,403);assert.deepEqual((await b.request(API_PATH+'/leaderboard')).data.entries,[]);
  const limited=await fixture(t,{pageSessionOptions:{maxPages:0}});const c=new Browser(limited.base);
  assert.equal((await c.enter()).response.status,200);assert.equal(c.pageId,null);
  assert.equal((await c.begin(limited.service.expectedRulesId)).response.status,403);
});
