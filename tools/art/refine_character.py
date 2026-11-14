"""Rebuild an imported character into task-owned coastal output; originals stay intact."""
import bpy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from refine_motion import author_motion
from refine_mesh import refine_geometry, batch_materials

name = sys.argv[sys.argv.index('--') + 1]
root = Path(__file__).resolve().parents[2]
source = root / 'assets/characters' / f'{name}.glb'
out = root / 'assets/characters/coastal' / f'{name}.glb'
blend = root / 'art-source/coastal' / f'{name}.blend'
out.parent.mkdir(parents=True, exist_ok=True)
blend.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
rig = next(obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE')
refine_geometry(name, rig)
author_motion(rig, -1 if name == 'bball' else 1, name in ('pony', 'whale'))
batch_materials(rig)
if name == 'bball':
    # This one legacy model faced +Z, unlike the rest of the roster and the track.
    rig.rotation_mode = 'XYZ'
    rig.rotation_euler.z = 3.141592653589793
    for obj in list(bpy.context.scene.objects):
        if obj.type == 'MESH' and obj.parent != rig and any(m.type == 'ARMATURE' and m.object == rig for m in obj.modifiers):
            obj.rotation_euler.z = 3.141592653589793
rig['sourceAsset'] = str(source.relative_to(root))
bpy.ops.object.select_all(action='DESELECT')
for obj in bpy.context.scene.objects:
    if obj == rig or obj.type == 'MESH' and any(m.type == 'ARMATURE' and m.object == rig for m in obj.modifiers):
        obj.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(blend), compress=True)
bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB', use_selection=True,
    export_animations=True, export_animation_mode='NLA_TRACKS', export_extras=True,
    export_yup=True, export_force_sampling=True, export_frame_range=False)
print('REFINED', source, '->', out)
