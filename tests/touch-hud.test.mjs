import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sourceLiterals } from './source-literals.mjs';
import { UiHost } from '../packages/framework/dist/ui/host.js';
import { Label, findBox, defaultUiConfig } from '../packages/framework/dist/ui/index.js';
import { buildHudPage } from '../packages/game/dist/ui/hudView.js';
import { loadTestFontSet } from './ui-helpers.mjs';

const data={score:1234567,coins:12345,distance:43210.9,hits:1,lives:3,
  buffs:[{name:'磁暴手套',left:9.1},{name:'磁暴手套',left:11},{name:'球形护盾',left:8.8},
    {name:'雷翼飞行包',left:5.4},{name:'弹跳鞋',left:7.2},{name:'金币收益',left:Infinity}],
  skill:{label:'雷霆冲刺',cd:0,ready:true,charge:null}};
function fixture(t,width=320,height=620){
  const host=new UiHost({adapter:{canvas:{onResize:()=>()=>{}},onInput:()=>()=>{},now:()=>0},
    inputMode:'raw',fonts:loadTestFontSet('assets/fonts/noto'),config:defaultUiConfig,
    overlayHost:{renderer:{autoClear:true,render(){}},width,height,dpr:1}});
  t.after(()=>host.dispose());const page=buildHudPage(host,{touchOnly:true});host.mount(page.view);
  const settle=()=>{for(let i=0;i<8;i++)host.overlay.tick(0);};
  const labels=()=>{const result=[];host.overlay.current.root.visit(w=>{if(w instanceof Label && w.visible)result.push(w);});return result;};
  return {host,page,settle,labels,text:()=>labels().map(w=>w.getText())};
}

test('phone HUD separates stats, merges actual buffs, and stays inside the safe viewport at 320/390/430px',t=>{
  const f=fixture(t);
  f.page.handle.update({...data,score:0,coins:0,distance:0,buffs:[]});f.settle();
  for(const width of [320,390,430]){
    f.host.overlay.resize(width,620,1);f.page.handle.update(data);f.settle();
    const text=f.text();for(const value of ['1,234,567 分','生命 2/3','采集金币 12,345','里程 43,210 m','雷霆冲刺：就绪（双击屏幕）'])assert.ok(text.includes(value),value);
    const buffs=text.find(s=>s.includes('磁暴手套'));assert.equal(buffs.match(/磁暴手套/g).length,1);assert.ok(buffs.includes('磁暴手套 11s'));
    assert.ok(buffs.includes('金币收益')&&!buffs.includes('Infinity'));
    for(const label of f.labels()){
      const r=findBox(f.host.overlay.tree,label.id).rect;
      assert.ok(r.x>=12&&r.x+r.w<=width-12+.01,`${width}: ${label.getText()} outside X bounds`);
      assert.ok(r.y>=0&&r.y+r.h<230,`${label.getText()} obstructs the middle/lower run view`);
    }
    const buffLabel=f.labels().find(label=>label.getText()===buffs);
    if(width===320)assert.ok(findBox(f.host.overlay.tree,buffLabel.id).rect.h>20,'narrow-screen buffs really wrap into measured lines');
  }
});

test('cooldown and slide charge keep their values; empty and disposed updates never leave stale UI or clear another page',t=>{
  const f=fixture(t);f.page.handle.update({...data,buffs:[],skill:{...data.skill,ready:false,cd:12.5}});f.settle();
  assert.ok(f.text().includes('雷霆冲刺：冷却 12.5s'));
  f.page.handle.update({...data,buffs:[],skill:{...data.skill,ready:false,charge:{now:7,need:10}}});f.settle();
  assert.ok(f.text().includes('雷霆冲刺：下滑 7/10'));
  f.page.handle.update({...data,buffs:[],skill:null});f.settle();assert.ok(!f.text().some(s=>s.includes('雷霆冲刺')||s.includes('磁暴手套')));
  const replacement=f.host.makeView();replacement.add(new Label({text:'大厅'}));f.host.mount(replacement);
  f.page.handle.dispose();f.page.handle.dispose();f.page.handle.update(data);
  assert.equal(f.host.overlay.current,replacement);assert.deepEqual(f.text(),['大厅']);
});

test('new touch HUD copy is covered by the shipped atlas',()=>{
  const fonts=loadTestFontSet('assets/fonts/noto'),missing=new Set();
  for(const literal of sourceLiterals(['packages/game/src/ui/coastalHud.ts']))
    for(const char of literal)if(/[^\x00-\x7f\s]/u.test(char)&&!fonts.lookup(char.codePointAt(0)))missing.add(char);
  assert.deepEqual([...missing],[]);
});
