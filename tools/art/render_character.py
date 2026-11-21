"""Offline GLB geometry/animation preview, not a WX renderer capture.

blender -b -t 2 --python tools/art/render_character.py -- input.glb output.png [clip] [phase]
An orthographic transparent portrait is also usable by the WX custom UI.
"""
import bpy
import math
import sys
from pathlib import Path
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
source, output = (Path(p).resolve() for p in args[:2])
clip = args[2] if len(args) > 2 else 'Idle'
phase = float(args[3]) if len(args) > 3 else 0.0
angle = float(args[4]) if len(args) > 4 else 12.0
size = int(args[5]) if len(args) > 5 else 512
portrait = len(args) > 6 and args[6] == 'portrait'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
for obj in bpy.data.objects:
    if obj.animation_data:
        ad = obj.animation_data
        ad.action = None
        for track in ad.nla_tracks:
            track.mute = True
            if track.name == clip:
                track.mute = False
scene = bpy.context.scene
scene.frame_set(1 + round(phase * scene.render.fps))
bpy.context.view_layer.update()
shapes = {bone.custom_shape for obj in scene.objects if obj.type == 'ARMATURE' for bone in obj.pose.bones}
depsgraph = bpy.context.evaluated_depsgraph_get()
points = [obj.matrix_world @ Vector(corner) for obj in scene.objects if obj.type == 'MESH' and obj not in shapes
          for corner in obj.evaluated_get(depsgraph).bound_box]
low, high = [Vector([f(p[i] for p in points) for i in range(3)]) for f in (min, max)]
center = (low + high) / 2
height = high.z - low.z
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.threads_mode = 'FIXED'
scene.render.threads = 2
scene.render.resolution_x = size
scene.render.resolution_y = round(size * 4/3) if portrait else size
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'Medium High Contrast'
scene.world = bpy.data.worlds.new('Warm coastal studio')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.72, 0.85, 1.0, 1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = .5

def area(name, position, power, color, radius):
    light = bpy.data.lights.new(name, 'AREA')
    light.energy, light.color, light.shape, light.size = power, color, 'DISK', radius
    obj = bpy.data.objects.new(name, light)
    scene.collection.objects.link(obj)
    obj.location = position
    obj.rotation_euler = (center - obj.location).to_track_quat('-Z', 'Y').to_euler()

area('Warm sun', (3, 4, 6), 380, (1, .9, .76), 4)
area('Sea fill', (-3, 1, 3), 180, (.68, .86, 1), 3)
area('Rim', (1, -3, 4), 270, (1, .94, .84), 3)
camera = bpy.data.cameras.new('Portrait camera')
camera.type, camera.ortho_scale = 'ORTHO', max(height, high.x - low.x) * (1.10 if portrait else 1.23)
cam = bpy.data.objects.new('Portrait camera', camera)
scene.collection.objects.link(cam)
theta = math.radians(angle)
cam.location = center + Vector((math.sin(theta) * 5, math.cos(theta) * 5, height * .12))
cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
scene.render.filepath = str(output)
output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.render.render(write_still=True)
print('PREVIEW', source.name, clip, phase, 'bounds', list(low), list(high), '->', output)
