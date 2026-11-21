import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { UiHost } from '../packages/framework/dist/ui/host.js';
import { Label, findBox, defaultUiConfig } from '../packages/framework/dist/ui/index.js';
import { mountLeaderboardPage } from '../packages/game/dist/ui/leaderboardView.js';
import { WelfareAction, coast } from '../packages/game/dist/ui/welfareCards.js';
import { loadTestFontSet } from './ui-helpers.mjs';

function hostFor(t,width=320,height=560){
  const host=new UiHost({adapter:{canvas:{onResize:()=>()=>{}},onInput:()=>()=>{},now:()=>0},
    inputMode:'raw',fonts:loadTestFontSet('assets/fonts/noto'),config:defaultUiConfig,
    overlayHost:{renderer:{autoClear:true,render(){}},width,height,dpr:1}});
  t.after(()=>host.dispose());return host;
}
const flush=async host=>{await new Promise(setImmediate);for(let i=0;i<3;i++)host.overlay.tick(0);};
function widgets(host,Type){const found=[];host.overlay.current.root.visit(w=>{if(w instanceof Type)found.push(w);});return found;}
function click(host,title){host.overlay.tick(0);const button=widgets(host,WelfareAction).find(b=>b.label.getText()===title);assert.ok(button,title);
  const {rect}=findBox(host.overlay.tree,button.id);assert.ok(rect.h>=44&&rect.w>=44);assert.ok(rect.y>=0&&rect.y+rect.h<=host.overlay.current.height);
  const p={x:rect.x+rect.w/2,y:rect.y+rect.h/2,t:1};host.pushInput({type:'down',...p});host.pushInput({type:'up',...p});}
const entry={rank:61,playerName:'一位名字较长的海滨跑酷伙伴',distance:432.198,score:123,charId:'char_volt'};

test('coastal leaderboard shows real personal rank and exact-role portrait without substituting unknown ids',async t=>{
  const host=hostFor(t),texture=new THREE.Texture(),source={texture,texSize:{w:384,h:512},insets:{top:0,bottom:0,left:0,right:0}};
  t.after(()=>texture.dispose());const server={entries:[{...entry,rank:1},{...entry,rank:2,charId:'unknown'}],personal:entry,playerName:entry.playerName};
  const stop=mountLeaderboardPage(host,{list:async()=>server},()=>{},{portraits:{char_volt:source}});await flush(host);
  const labels=widgets(host,Label).map(w=>w.getText());
  assert.ok(labels.includes('个人最佳：61. '+entry.playerName));assert.ok(labels.includes('432.20 m'));
  assert.ok(labels.includes('金币前得分 123'));assert.ok(labels.some(s=>s.includes('第一次吃金币前')));
  let count=0;host.overlay.current.root.visit(w=>{if(w.opts?.background===source)count++;});assert.equal(count,2);
  let sand=false;host.overlay.current.root.visit(w=>{if(w.opts?.backgroundColor===coast.sand)sand=true;});assert.ok(sand);
  for(const control of widgets(host,WelfareAction)){const r=findBox(host.overlay.tree,control.id).rect;assert.ok(r.h>=44&&r.w>=44);}
  stop();
});

test('first failure, empty record, duplicate refresh, expansion and back are actionable in a short safe viewport',async t=>{
  const host=hostFor(t);let reject=true,calls=0,back=0,release;
  const service={list:()=>{calls++;return reject?Promise.reject(Error('offline')):new Promise(resolve=>{release=resolve;});}};
  const stop=mountLeaderboardPage(host,service,()=>back++);await flush(host);
  assert.ok(widgets(host,Label).some(w=>w.getText()==='加载失败，请重试'));
  reject=false;click(host,'刷新');click(host,'刷新');assert.equal(calls,2);
  release({entries:[],personal:null,playerName:'自己'});await flush(host);
  assert.ok(widgets(host,Label).some(w=>w.getText()==='暂无纪录'));
  assert.ok(widgets(host,Label).some(w=>w.getText()==='个人最佳：暂无纪录'));
  click(host,'返回');assert.equal(back,1);
  stop();
});
