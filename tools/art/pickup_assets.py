"""Run: blender -b -t 2 --python tools/art/pickup_assets.py -- [--replace-owned]"""
import bpy
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).parent))
from pickup_assets_models import BUILDERS
from pickup_assets_geometry import join_center


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--replace-owned', action='store_true', help='Explicitly regenerate this pipeline output')
    parser.add_argument('--names', nargs='+', choices=list(BUILDERS), default=list(BUILDERS))
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    paths = [ROOT/'assets/pickups/coastal'/f'{n}.glb' for n in args.names]
    paths += [ROOT/'art-source/pickups-coastal'/f'{n}.blend' for n in args.names]
    if not args.replace_owned and any(p.exists() for p in paths):
        raise RuntimeError('Output already exists; inspect ownership before --replace-owned')
    for p in paths:
        p.parent.mkdir(parents=True, exist_ok=True)
    for name in args.names:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.context.preferences.filepaths.save_version = 0
        BUILDERS[name]()
        o = join_center('Coastal club | '+name)
        # Selection contains one logical mesh, <=4 material primitives.
        bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art-source/pickups-coastal'/f'{name}.blend'))
        bpy.ops.export_scene.gltf(filepath=str(ROOT/'assets/pickups/coastal'/f'{name}.glb'),
                                  export_format='GLB', use_selection=True,
                                  export_yup=True, export_materials='EXPORT', export_extras=True,
                                  export_animations=False, export_cameras=False, export_lights=False)
        o.data.calc_loop_triangles()
        print('PICKUP_STATS '+json.dumps({'name':name,'triangles':len(o.data.loop_triangles),
              'bounds_blender':list(o.dimensions),'materials':len(o.data.materials)}))


if __name__ == '__main__':
    main()
