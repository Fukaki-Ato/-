"""Blender Cycles CPU offline inspection of coast_snapshot.mjs output.
The actual mesh/instance/color data are preserved; toon, sea, mist, ground texture,
sky and lighting are approximate and are NOT a WeChat framebuffer capture.
blender -b -t 2 --python tools/art/coast_render.py -- SNAPSHOT OUTPUT_PREFIX
"""
import bpy
import json
import math
import sys
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index('--') + 1:]
source, prefix = args[:2]
views = args[2:] or ['run', 'exhibit']
with open(source) as f:
    data = json.load(f)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 16
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 3
scene.render.threads_mode = 'FIXED'
scene.render.threads = 2
scene.world.color = (0.38, 0.55, 0.65)
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.view_settings.exposure = 0
scene.view_settings.gamma = 1
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))

def material(record):
    m = bpy.data.materials.new('offline-' + record['kind'])
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    principled = nodes.new('ShaderNodeBsdfPrincipled')
    principled.inputs['Roughness'].default_value = 0.8
    color = record['color']
    principled.inputs['Base Color'].default_value = (*color, 1)
    if record['kind'] == 'sea':
        # Approximate uLight/uDeep and haze; the actual animated GLSL stays in source.
        geom = nodes.new('ShaderNodeNewGeometry')
        xyz = nodes.new('ShaderNodeSeparateXYZ')
        mapper = nodes.new('ShaderNodeMapRange')
        mapper.inputs['From Min'].default_value = -85
        mapper.inputs['From Max'].default_value = -12
        links.new(geom.outputs['Position'], xyz.inputs[0])
        links.new(xyz.outputs['X'], mapper.inputs['Value'])
        ramp = nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].color = (0.10, 0.30, 0.46, 1)
        ramp.color_ramp.elements[1].color = (0.18, 0.56, 0.68, 1)
        links.new(mapper.outputs['Result'], ramp.inputs[0])
        links.new(ramp.outputs[0], principled.inputs['Base Color'])
        principled.inputs['Roughness'].default_value = 0.3
    elif record['kind'] == 'shallow':
        principled.inputs['Base Color'].default_value = (0.25, 0.66, 0.73, 1)
        principled.inputs['Alpha'].default_value = 0.22
    elif record['kind'] == 'pool':
        principled.inputs['Base Color'].default_value = (0.65, 0.81, 0.86, 1)
        principled.inputs['Alpha'].default_value = 0.025
    else:
        attr = nodes.new('ShaderNodeVertexColor')
        attr.layer_name = 'Color'
        mult = nodes.new('ShaderNodeMixRGB')
        mult.blend_type = 'MULTIPLY'
        mult.inputs[0].default_value = 1
        mult.inputs[2].default_value = (*color, 1)
        links.new(attr.outputs['Color'], mult.inputs[1])
        inst = nodes.new('ShaderNodeObjectInfo')
        instance_tint = nodes.new('ShaderNodeMixRGB')
        instance_tint.blend_type = 'MULTIPLY'
        instance_tint.inputs[0].default_value = 1
        links.new(mult.outputs[0], instance_tint.inputs[1])
        links.new(inst.outputs['Color'], instance_tint.inputs[2])
        links.new(instance_tint.outputs[0], principled.inputs['Base Color'])
        if record['transparent']:
            principled.inputs['Alpha'].default_value = record['opacity']
        if record['kind'] == 'basic':
            links.new(instance_tint.outputs[0], principled.inputs['Emission Color'])
            principled.inputs['Emission Strength'].default_value = 0.55
    if record['kind'] in ('toon', 'standard'):
        # Approximate runnerScene's linear Fog(22, 120) after surface shading.
        camera_info = nodes.new('ShaderNodeCameraData')
        fade = nodes.new('ShaderNodeMapRange')
        fade.name = 'inspectionFog'
        fade.inputs['From Min'].default_value = 22
        fade.inputs['From Max'].default_value = 120
        links.new(camera_info.outputs['View Distance'], fade.inputs[0])
        haze = nodes.new('ShaderNodeEmission')
        haze.inputs[0].default_value = (0.624, 0.815, 0.922, 1)
        mix = nodes.new('ShaderNodeMixShader')
        links.new(fade.outputs[0], mix.inputs[0])
        links.new(principled.outputs[0], mix.inputs[1])
        links.new(haze.outputs[0], mix.inputs[2])
        links.new(mix.outputs[0], out.inputs['Surface'])
    else:
        links.new(principled.outputs[0], out.inputs['Surface'])
    return m

mesh_data = {}
for rec in data['meshes']:
    if rec['kind'] == 'sky':
        continue  # World background approximation instead of inside-out shader dome.
    gi = rec['geometry']
    if gi not in mesh_data:
        g = data['geometries'][gi]
        pos = g['positions']
        verts = [tuple(pos[i:i+3]) for i in range(0, len(pos), 3)]
        indices = g['indices'] or list(range(len(verts)))
        faces = [indices[i:i+3] for i in range(0, len(indices), 3)]
        mesh = bpy.data.meshes.new('actual-' + str(gi))
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        colors = mesh.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='POINT')
        col = g['colors']
        for i in range(len(verts)):
            colors.data[i].color = (*col[i*3:i*3+3], 1) if col else (1, 1, 1, 1)
        mesh_data[gi] = mesh
    mesh = mesh_data[gi]
    mesh.materials.append(material(rec))
    for i, values in enumerate(rec['matrices']):
        obj = bpy.data.objects.new((rec['name'] or rec['kind']) + '-' + str(i), mesh)
        scene.collection.objects.link(obj)
        mat = Matrix([values[j::4] for j in range(4)])
        obj.matrix_world = C @ mat
        obj.color = (*rec['colors'][i], 1) if rec['colors'] else (1, 1, 1, 1)
        # Ignore glint quads at their zero phase; approximate additive pieces otherwise.
        if rec['colors'] and max(rec['colors'][i]) < 0.01:
            obj.hide_render = True

world = scene.world
world.use_nodes = True
wn = world.node_tree.nodes
wl = world.node_tree.links
ambient = wn['Background']
ambient.inputs[0].default_value = (0.53, 0.75, 0.87, 1)
ambient.inputs[1].default_value = 0.65
sky = wn.new('ShaderNodeBackground')
coords = wn.new('ShaderNodeTexCoord')
xyz = wn.new('ShaderNodeSeparateXYZ')
wl.new(coords.outputs['Normal'], xyz.inputs[0])
vertical = wn.new('ShaderNodeMapRange')
vertical.inputs['From Min'].default_value = 0
vertical.inputs['From Max'].default_value = 0.7
wl.new(xyz.outputs['Z'], vertical.inputs[0])
gradient = wn.new('ShaderNodeMixRGB')
gradient.inputs[1].default_value = (0.624, 0.815, 0.922, 1)
gradient.inputs[2].default_value = (0.078, 0.381, 0.730, 1)
wl.new(vertical.outputs[0], gradient.inputs[0])
wl.new(gradient.outputs[0], sky.inputs[0])
ray = wn.new('ShaderNodeLightPath')
world_mix = wn.new('ShaderNodeMixShader')
wl.new(ray.outputs['Is Camera Ray'], world_mix.inputs[0])
wl.new(ambient.outputs[0], world_mix.inputs[1])
wl.new(sky.outputs[0], world_mix.inputs[2])
wl.new(world_mix.outputs[0], wn['World Output'].inputs[0])
sun_data = bpy.data.lights.new('warm-daylight-approximation', 'SUN')
sun_data.energy = 1.7
sun_data.angle = 0.2
sun = bpy.data.objects.new('daylight', sun_data)
scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(25), math.radians(-22), math.radians(-30))
camera_data = bpy.data.cameras.new('inspection')
camera = bpy.data.objects.new('inspection', camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
for name in views:
    rig = data['cameras'][name]
    position = rig.get('position', [0, rig.get('camY', 2.7), rig.get('camZ', 8.4)])
    target = rig.get('target', [0, rig.get('lookY', 0), rig.get('lookZ', -9.5)])
    camera.location = C @ Vector(position)
    aim = C @ Vector(target)
    camera.rotation_euler = (aim-camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera_data.sensor_fit = 'VERTICAL'
    camera_data.sensor_height = 24
    camera_data.lens = 12 / math.tan(math.radians(rig['fov']) / 2)
    camera_data.clip_end = rig['far']
    # Exhibit/detail are explicitly de-fogged geometry inspection, not runtime views.
    for m in bpy.data.materials:
        fade = m.node_tree.nodes.get('inspectionFog') if m.use_nodes else None
        if fade:
            fade.inputs['From Min'].default_value = 22 if name == 'run' else 10000
            fade.inputs['From Max'].default_value = 120 if name == 'run' else 11000
    scene.render.resolution_x = 640 if name == 'run' else 1100
    scene.render.resolution_y = 960 if name == 'run' else 760
    scene.render.resolution_percentage = 100
    scene.render.filepath = prefix + '-' + name + '.png'
    bpy.ops.render.render(write_still=True)
print('OFFLINE APPROXIMATION: actual source geometry; not WX pixels')
