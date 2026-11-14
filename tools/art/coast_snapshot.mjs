// Actual source geometry/instances, not an independently recreated illustration.
// Usage: node tools/art/coast_snapshot.mjs OUTPUT.json [distance=0] [time=2]
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export async function loadCoast(sourceDir) {
  const result = await build({
    stdin: { contents: `export {createCoastProps} from './packages/game/src/render/coast/coastProps.ts';
      export {createTrackVisuals} from './packages/game/src/render/trackVisuals.ts';
      export {camTargets} from './packages/game/src/render/cameraRig.ts'; export * as THREE from 'three';`,
      resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: sourceDir ? [{ name: 'saved-coast-source', setup(b) {
      b.onLoad({ filter: /\/render\/coast\/[^/]+\.ts$/ }, async args => ({
        contents: await readFile(path.join(sourceDir, path.basename(args.path)), 'utf8'), loader: 'ts',
      }));
    } }] : [],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

export function measure(scene) {
  const geometries = new Set(), materials = new Set();
  let batches = 0, instances = 0, triangles = 0, storedTriangles = 0, vertices = 0;
  scene.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry, n = o.isInstancedMesh ? o.count : 1;
    batches += Array.isArray(o.material) ? o.material.length : 1;
    instances += n;
    triangles += (g.index?.count ?? g.attributes.position.count) / 3 * n;
    if (!geometries.has(g)) {
      storedTriangles += (g.index?.count ?? g.attributes.position.count) / 3;
      vertices += g.attributes.position.count;
    }
    geometries.add(g);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
  });
  return { geometries: geometries.size, materials: materials.size, batches, instances,
    triangles, storedTriangles, vertices };
}

export function snapshot(scene, THREE) {
  scene.updateMatrixWorld(true);
  const geometries = [], meshes = [], ids = new Map();
  scene.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry;
    if (!ids.has(g)) {
      ids.set(g, geometries.length);
      geometries.push({ positions: Array.from(g.attributes.position.array),
        colors: g.attributes.color ? Array.from(g.attributes.color.array) : null,
        indices: g.index ? Array.from(g.index.array) : null });
    }
    const m = o.material, shader = m.isShaderMaterial;
    const kind = shader ? (m.uniforms.uDeep ? 'sea' : m.uniforms.uC ? 'shallow' :
      m.uniforms.top ? 'sky' : 'pool') : m.isMeshToonMaterial ? 'toon' : m.isMeshBasicMaterial ? 'basic' : 'standard';
    const matrices = [], colors = [], matrix = new THREE.Matrix4(), col = new THREE.Color();
    for (let i = 0; i < (o.isInstancedMesh ? o.count : 1); i++) {
      if (o.isInstancedMesh) { o.getMatrixAt(i, matrix); matrix.premultiply(o.matrixWorld); }
      else matrix.copy(o.matrixWorld);
      matrices.push(matrix.toArray());
      if (o.instanceColor) { o.getColorAt(i, col); colors.push(col.toArray()); }
    }
    meshes.push({ name: o.name, geometry: ids.get(g), kind, matrices, colors,
      color: m.color?.toArray() ?? [1, 1, 1], opacity: m.opacity, transparent: m.transparent,
      additive: m.blending === THREE.AdditiveBlending, castShadow: o.castShadow });
  });
  return { geometries, meshes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [output, distance = '0', time = '2', sourceDir] = process.argv.slice(2);
  if (!output) throw new Error('Provide an exclusive new OUTPUT.json path');
  const { createCoastProps, createTrackVisuals, camTargets, THREE } = await loadCoast(sourceDir);
  const coast = new THREE.Scene(), props = createCoastProps(coast);
  props.update(Number(distance), Number(time));
  const scene = new THREE.Scene();
  const game = JSON.parse(await readFile('config/game.json', 'utf8'));
  const laneWidth = game.params.runner.laneWidth;
  const track = createTrackVisuals(scene, laneWidth, { baseColor: '#4FA6DE', flashColor: '#ffffff',
    tint: '#FFF0C8', groundColor: '#EFDDB8', sky: { zenith: '#4FA6DE', horizon: '#CFE9F6' } }, 'coast');
  track.update(Number(distance), Number(time));
  const data = { note: 'Actual Three geometry and matrices; Blender shaders/lighting are offline approximations, not WX pixels.',
    distance: Number(distance), time: Number(time), coastMetrics: measure(coast),
    cameras: { run: { ...camTargets(0, false), lookZ: -9.5, far: 160 },
      exhibit: { position: [36, 27, 45], target: [-13, 0, -55], fov: 55, far: 400 },
      detail: { position: [20, 8, -85], target: [5, 1.2, -108], fov: 55, far: 160 } },
    ...snapshot(scene, THREE) };
  await writeFile(output, JSON.stringify(data), { flag: 'wx' });
  console.log(JSON.stringify({ output, coastMetrics: data.coastMetrics }));
}
