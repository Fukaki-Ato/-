import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createPickupBeaconGeometry, PICKUP_BEACON_COLORS } from '../packages/game/dist/render/pickupBeacons.js';
import { createPickupLayer } from '../packages/game/dist/render/pickupLayer.js';
import { setPickupTiles } from '../packages/game/dist/render/pickupTiles.js';
import { createPickupModelLoader } from '../packages/game/dist/render/pickupModels.js';

const pickup = (itemRef, worldZ = 100, lane = 0) => ({ itemRef, worldZ, lane });

test('seven fallback beacons have distinct real silhouettes, bounded geometry and a consistent front plane', () => {
  const shapes = new Set();
  for (const id of Object.keys(PICKUP_BEACON_COLORS)) {
    const geometry = createPickupBeaconGeometry(id);
    geometry.computeBoundingBox();
    const { min, max } = geometry.boundingBox;
    assert.ok(max.x-min.x <= .6 && max.y-min.y <= .6, id);
    assert.equal(min.z, 0); assert.equal(max.z, 0);
    assert.ok(geometry.index.count > 6 && geometry.index.count/3 < 500, id);
    shapes.add(JSON.stringify([...geometry.attributes.position.array]));
    geometry.dispose();
  }
  assert.equal(shapes.size, 7, 'not seven recoloured copies of a square');
});

test('WX without injected images: far and loading pickups show the right coloured sign; tile injection keeps its own art', () => {
  setPickupTiles([]);
  const scene = new THREE.Scene(), layer = createPickupLayer(scene, 2.2);
  const boxes = scene.children.filter(o=>o.geometry?.type === 'BoxGeometry');
  const refs = Object.keys(PICKUP_BEACON_COLORS);
  layer.update(refs.map((id,i)=>pickup(id,80+i*8, i%3-1)),0,1);
  for(let i=0;i<refs.length;i++) {
    const box = boxes[i], icon = box.children[0];
    assert.equal(box.visible,true); assert.equal(icon.visible,true);
    assert.equal(icon.geometry.name, `pickup-beacon:${refs[i]}`);
    assert.ok(icon.position.z > .35, 'sign sits on the player-facing face');
    assert.equal(box.material.map,null);
    assert.equal(box.material.color.getHex(), PICKUP_BEACON_COLORS[refs[i]]);
  }
  const tile = new THREE.Texture();
  setPickupTiles([{item:'item_boots',tex:tile}]);
  layer.update([pickup('item_boots')],0,1);
  assert.equal(boxes[0].material.map,tile); assert.equal(boxes[0].children[0].visible,false);
  setPickupTiles([]); tile.dispose(); layer.dispose(); assert.equal(scene.children.length,0);
});

test('model hysteresis forgets objects that leave the view; shared clones are detached without duplicate owner disposal', () => {
  const source = new THREE.Group(), geometry = new THREE.BoxGeometry(.5,.5,.5), material = new THREE.MeshStandardMaterial();
  source.add(new THREE.Mesh(geometry,material));
  let disposed=0; geometry.addEventListener('dispose',()=>disposed++);
  const scene = new THREE.Scene(), layer = createPickupLayer(scene,2.2,{
    hasPrefab:()=>true,model:()=>source,spins:()=>false,
  });
  const groups=scene.children.filter(o=>o.isGroup), boxes=scene.children.filter(o=>o.geometry?.type === 'BoxGeometry');
  const p=pickup('item_shield',134);
  layer.update([p],100,0); assert.equal(groups[0].visible,true);
  layer.update([p],96,0); assert.equal(groups[0].visible,true,'in the hysteresis band');
  layer.update([],96,0); assert.ok(groups.every(g=>!g.visible));
  layer.update([p],96,0); assert.equal(groups[0].visible,false,'out-of-view history has been released');
  assert.equal(boxes[0].visible,true);
  layer.dispose(); assert.equal(scene.children.length,0);
  assert.equal(disposed,0,'model geometry belongs to loader, not clone slots');
  geometry.dispose();material.dispose();assert.equal(disposed,1);
});

test('beacon updates reuse a finite geometry set and tear it down with the owning run', () => {
  setPickupTiles([]);
  const scene=new THREE.Scene(),layer=createPickupLayer(scene,2.2), geometries=new Set(),materials=new Set();
  for(let i=0;i<1000;i++) {
    const ids=Object.keys(PICKUP_BEACON_COLORS);
    layer.update(ids.map((id,k)=>pickup(id, i*10+k+100)),i*10,i/60);
    scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});
  }
  assert.equal(geometries.size,10,'one box, seven prebuilt signs, the unconfigured-item symbol and one shared glow plane');
  assert.equal(materials.size,17,'eight box materials, one sign material and eight pooled glow materials');
  let released=0;
  for(const g of geometries)g.addEventListener('dispose',()=>released++);
  layer.dispose();assert.equal(released,geometries.size);assert.equal(scene.children.length,0);
});

test('real configured drops and multiplier load once, replace beacons with actual GLB clones and release shared resources once',async()=>{
  const content=Object.fromEntries(['items','obstacles'].map(name=>[name,JSON.parse(readFileSync(`config/${name}.json`,'utf8'))]));
  const drops=Object.keys(content.obstacles.dropTable.weights);
  assert.equal(drops.length,6);assert.ok(!drops.includes('item_multiplier'),'the art change does not alter the authored drop table');
  const ids=[...drops,'item_multiplier'],reads=[];
  const loader=createPickupModelLoader(content,{extras:{readBinary:async path=>{
    reads.push(path);const bytes=readFileSync(path);return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  }}});
  const scene=new THREE.Scene(),layer=createPickupLayer(scene,2.2,loader),list=ids.map((id,i)=>pickup(id,20+i,i%3-1));
  const before=structuredClone(list),groups=scene.children.filter(o=>o.isGroup),boxes=scene.children.filter(o=>o.geometry?.type === 'BoxGeometry');
  layer.update(list,0,1);assert.equal(boxes.filter(b=>b.visible).length,ids.length,'still legible during asynchronous IO');
  await new Promise(setImmediate);
  layer.update(list,0,2);assert.equal(groups.filter(g=>g.visible).length,ids.length);
  assert.ok(boxes.every(b=>!b.visible),'not a mixture of duplicate box/model for one drop');
  const clones=groups.slice(0,ids.length).map(g=>g.children[0]);
  layer.update(list,0,3);assert.deepEqual(groups.slice(0,ids.length).map(g=>g.children[0]),clones);
  assert.equal(reads.length,ids.length,'all actual file loads are cached');
  assert.deepEqual(list,before,'rendering never writes pickup state');
  const sourceGeometries=new Set(),disposed=new Map();
  for(const id of ids)loader.model(id).traverse(o=>{if(o.geometry)sourceGeometries.add(o.geometry);});
  for(const geometry of sourceGeometries)geometry.addEventListener('dispose',()=>disposed.set(geometry,(disposed.get(geometry)??0)+1));
  layer.dispose();assert.equal(disposed.size,0,'clones do not own loader resources');assert.equal(scene.children.length,0);
  loader.dispose();assert.equal(disposed.size,sourceGeometries.size);assert.ok([...disposed.values()].every(n=>n===1));
});
