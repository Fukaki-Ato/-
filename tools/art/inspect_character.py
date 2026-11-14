"""Blender: import a shipped GLB and report editable geometry, skin and action slots."""
import bpy
import json
import sys
from pathlib import Path

path = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(path))
for obj in bpy.data.objects:
    if obj.type == 'ARMATURE':
        print('RIG', obj.name, 'location', tuple(obj.location), 'rotation', tuple(obj.rotation_euler))
        for bone in obj.data.bones:
            print('BONE', bone.name, tuple(round(v, 4) for v in bone.head_local),
                  tuple(round(v, 4) for v in bone.tail_local))
    elif obj.type == 'MESH':
        print('MESH', obj.name, len(obj.data.vertices), len(obj.data.polygons),
              'groups', [g.name for g in obj.vertex_groups], 'size', tuple(round(v, 3) for v in obj.dimensions))
for action in bpy.data.actions:
    print('ACTION', action.name, tuple(action.frame_range),
          'slots', [(s.identifier, s.target_id_type) for s in action.slots])
