// Offline/sample fixtures only. Reuse the real pure welfare projection/grants, never cloud IO.
import { createRequire } from 'node:module';
import { getMissionPeriods } from '../../apps/server/src/periods.mjs';

const require = createRequire(import.meta.url);
const { initialContent, newProfile } = require('../../cloudfunctions/thunder-api/profile.cjs');
const { ensureWelfare, welfareView, claimWelfare, touchProfile } = require('../../cloudfunctions/thunder-api/welfare-policy.cjs');
const flush = async host => { await Promise.resolve(); await Promise.resolve(); for(let i=0;i<8;i++)host.overlay.tick(0); };

export async function mountUiState(ui, host, content, fixture, page) {
  const input = [], calls = [], noop = () => {};
  const click = async title => {
    await flush(host);
    let button;
    host.overlay.current.root.visit(w=>{ if(!button && w.label?.getText?.()===title && w.handlers()?.onClick)button=w; });
    if(!button)throw Error(`Missing action for state observation: ${title}`);
    for(let attempt=0;attempt<3;attempt++) {
      const tree=host.overlay.tree, target=ui.findBox(tree,button.id).rect;
      let scroll;
      host.overlay.current.root.visit(w=>{
        if(w instanceof ui.ScrollView && ui.findBox(ui.findBox(tree,w.id),button.id))scroll=w;
      });
      if(!scroll)break;
      const r=ui.findBox(tree,scroll.id).rect, center=target.y+target.h/2;
      if(center>=r.y+4 && center<r.y+r.h-4)break;
      const delta=Math.min(scroll.physics.maxOffset-scroll.physics.offset,
        Math.max(-scroll.physics.offset,center-(r.y+r.h/2)));
      const x=r.x+r.w/2,y=r.y+r.h*.75,t=1+attempt;
      const events=[{type:'down',x,y,t},{type:'move',x,y:y-delta,t:t+.1},{type:'up',x,y:y-delta,t:t+.3}];
      for(const event of events){input.push(event);host.pushInput(event);}
      for(let i=0;i<180;i++)host.overlay.tick(1/60);
    }
    const r=ui.findBox(host.overlay.tree,button.id).rect;
    const x=r.x+r.w/2,y=r.y+r.h/2;
    for(const type of ['down','up']){const event={type,x,y,t:5};input.push(event);host.pushInput(event);}
    await flush(host);
  };
  if(page.startsWith('hud-')) {
    const kind=page.slice(4), views=ui.createWxGameViews(host,{},undefined,undefined,()=>true);
    const handle=views.mountHud();
    handle.update({score:1234567,coins:12345,distance:43210.9,hits:1,lives:3,
      buffs:kind==='buffs'?[{name:'磁暴手套',left:9.1},{name:'球形护盾',left:8.8},{name:'雷翼飞行包',left:5.4},
        {name:'弹跳鞋',left:7.2},{name:'金币收益',left:Infinity}]:[],
      skill:{label:'雷霆冲刺',cd:kind==='cooldown'?12.5:0,ready:kind==='ready',
        charge:kind==='charge'?{now:7,need:10}:null},...fixture.hud});
    return {dispose:()=>{handle.dispose();views.dispose();},input,calls};
  }
  const mode=page.startsWith('handbook')?'handbook':'tasks', state=page.slice(mode.length+1);
  const time=Date.UTC(2026,10,7,4), runtime={economy:content.economy,getMissionPeriods};
  let profile=ensureWelfare(newProfile(`p_${'a'.repeat(64)}`,initialContent(content.characters,content.themes),
    new Date(time).toISOString()),runtime,time).profile;
  profile.wallet={coin:120,diamond:8};profile.inventory.items={key:3};
  for(const period of ['daily','weekly','handbook']) {
    const group=profile.welfare[period];
    for(const [i,definition] of group.definitions.entries())group.progress[definition.id]=i===0?definition.target:Math.floor(definition.target*.36);
  }
  const snapshot=()=>fixture.welfare??welfareView(profile,runtime,time);
  const claim=event=>{
    calls.push(event);
    if(state==='claiming')return new Promise(noop);
    if(state==='failed')return Promise.reject(Error('offline/sample claim failure'));
    claimWelfare(profile,event);
    profile=touchProfile(profile,time);
    return Promise.resolve(snapshot());
  };
  const service={load:()=>{
    calls.push({action:'welfare.get'});
    if(state==='loading')return new Promise(noop);
    if(state==='load-failed')return Promise.reject(Error('offline/sample load failure'));
    return Promise.resolve(snapshot());
  },claimMission:(period,periodId,missionId)=>claim({action:'mission.claim',period,periodId,missionId}),
  claimChapter:chapterId=>claim({action:'handbook.claim',chapterId})};
  const dispose=ui.mountWelfarePage(host,state==='missing'?undefined:service,mode,noop);
  await flush(host);
  if(state==='weekly')await click('每周任务');
  if(['claiming','claimed','failed'].includes(state))await click('领取奖励');
  return {dispose,input,calls};
}
