"""Original magnet: Blender -b -t 2 --python tools/art/coastal_magnet.py.

No input art. X/Z is the horseshoe plane; Blender -Y exports to glTF +Z.
--review-dir NEW_DIR imports only the delivered coastal/magnet.glb for studies.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
GLB = ROOT / 'assets/pickups/coastal/magnet.glb'
BLEND = ROOT / 'art-source/pickups-coastal/magnet.blend'
PARTS = []
MATS = []


def material(name, color, metal, roughness):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bs = m.node_tree.nodes['Principled BSDF']
    bs.inputs['Base Color'].default_value = (*color, 1)
    bs.inputs['Metallic'].default_value = metal
    bs.inputs['Roughness'].default_value = roughness
    return m


def finish(o, name, mat):
    o.name = name
    o.data.materials.append(MATS[mat])
    PARTS.append(o)
    return o


def terminal(name, x, z, dimensions, mat, bevel):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, 0, z))
    o = bpy.context.object
    o.scale = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mod = o.modifiers.new('Hand-set terminal chamfer', 'BEVEL')
    mod.width = bevel
    mod.segments = 1
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(o, name, mat)


def horseshoe():
    radius, half_width, center_z = .3088, .101, .0598
    half_depth, chamfer = .11355, .025
    h, d, c = half_width, half_depth, chamfer
    # Closed 16-point section: bevels plus a genuinely recessed navy channel
    # in EACH broad face. Channel floors sit 9mm below the enamel face.
    section = [(-h, -d+c), (-h+c, -d), (.030, -d),
               (.034, -d+.009), (.052, -d+.009), (.056, -d),
               (h-c, -d), (h, -d+c), (h, d-c), (h-c, d),
               (.056, d), (.052, d-.009), (.034, d-.009),
               (.030, d), (-h+c, d), (-h, d-c)]
    # Every station also has an explicit outward radial normal in X/Z.
    stations = [(-radius, .25, -1, 0)]
    for i in range(25):
        angle = math.pi + math.pi*i/24
        nx, nz = math.cos(angle), math.sin(angle)
        stations.append((radius*nx, center_z+radius*nz, nx, nz))
    stations.append((radius, .25, 1, 0))
    vertices = [(x+q*nx, y, z+q*nz)
                for x, z, nx, nz in stations for q, y in section]
    n = len(section)
    faces = [tuple(range(n-1, -1, -1))]
    colors = [0]
    for i in range(len(stations)-1):
        body_mat = 0 if stations[i][0]+stations[i+1][0] < 0 else 1
        for j in range(n):
            k = (j+1) % n
            faces.append((i*n+j, i*n+k, (i+1)*n+k, (i+1)*n+j))
            colors.append(3 if j in (2, 3, 4, 10, 11, 12) else body_mat)
    faces.append(tuple((len(stations)-1)*n+j for j in range(n)))
    colors.append(1)
    data = bpy.data.meshes.new('Original swept U | chamfer and insulation topology')
    data.from_pydata(vertices, [], faces)
    data.update()
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(data)
    bm.free()
    o = bpy.data.objects.new('Continuous red-blue horseshoe', data)
    bpy.context.collection.objects.link(o)
    for m in MATS:
        data.materials.append(m)
    for polygon, mat in zip(data.polygons, colors):
        polygon.material_index = mat
    PARTS.append(o)


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.scene.unit_settings.scale_length = 1
    PARTS.clear()
    MATS[:] = [material('Pole red | coastal enamel', (.80, .035, .055), .16, .31),
               material('Pole blue | coastal enamel', (.018, .26, .78), .16, .31),
               material('Contact | salt ivory ceramic', (.88, .91, .84), .12, .30),
               material('Insulation | deep marine navy', (.018, .046, .080), .03, .43)]
    horseshoe()
    for x in (-.3088, .3088):
        terminal('Navy insulating terminal collar', x, .259,
                 (.202, .235, .022), 3, .006)
        terminal('Ivory chamfered pole contact', x, .310,
                 (.202, .2471, .080), 2, .012)
        for side in (-1, 1):
            # Paired solid ceramic pins; the back has the same readable detail.
            bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=.016,
                                               depth=.009, location=(x, side*.11355, .145),
                                               rotation=(math.pi/2, 0, 0))
            finish(bpy.context.object, 'Flush ivory face pin', 2)
    bpy.ops.object.select_all(action='DESELECT')
    for o in PARTS:
        o.select_set(True)
    bpy.context.view_layer.objects.active = PARTS[0]
    bpy.ops.object.join()
    o = bpy.context.object
    old = list(o.data.materials)
    indices = [MATS.index(old[p.material_index]) for p in o.data.polygons]
    o.data.materials.clear()
    for m in MATS:
        o.data.materials.append(m)
    for p, index in zip(o.data.polygons, indices):
        p.material_index = index
    world = [o.matrix_world @ v.co for v in o.data.vertices]
    center = Vector(tuple((min(v[i] for v in world)+max(v[i] for v in world))/2 for i in range(3)))
    for vertex, position in zip(o.data.vertices, world):
        vertex.co = position-center
    o.location = (0, 0, 0)
    o.name = 'Coastal original magnet | red-blue U'
    o.data.name = 'Editable chamfered horseshoe with recessed twin face channels'
    # Primitive operators create unused UVs with tiny bevel-rounding variation.
    # This untextured model needs none; omit them from both editable and GLB data.
    for layer in list(o.data.uv_layers):
        o.data.uv_layers.remove(layer)
    o['source'] = 'Original hand-authored geometry; tools/art/coastal_magnet.py; no input assets'
    o['anchor'] = 'AABB center in metres; runtime applies PICKUP_CENTER_Y and model.spin'
    o['front'] = 'Blender -Y / glTF +Z; matched front and rear details'
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
    bpy.ops.export_scene.gltf(filepath=str(GLB), export_format='GLB',
                              use_selection=True, export_yup=True,
                              export_materials='EXPORT', export_extras=True,
                              export_animations=False, export_cameras=False,
                              export_lights=False)
    o.data.calc_loop_triangles()
    print('MAGNET_STATS '+json.dumps({'triangles': len(o.data.loop_triangles),
          'materials': len(o.data.materials), 'bytes': GLB.stat().st_size,
          'gltf_size': [o.dimensions.x, o.dimensions.z, o.dimensions.y]}))


def area(name, position, power, size, color):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.size, data.color = power, size, color
    o = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(o)
    o.location = position
    o.rotation_euler = (-o.location).to_track_quat('-Z', 'Y').to_euler()


def review(out):
    out.mkdir(parents=True, exist_ok=False)
    for side in ('front', 'rear'):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(GLB))
        # Review lights/camera/ground exist only in memory, never in the asset.
        bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.365))
        ground = bpy.context.object
        mat = material('Review only | sand', (.13, .19, .225), 0, .7)
        ground.data.materials.append(mat)
        scene = bpy.context.scene
        scene.world = bpy.data.worlds.new('Review only | coastal overcast')
        scene.world.use_nodes = True
        scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.30, .40, .52, 1)
        scene.world.node_tree.nodes['Background'].inputs[1].default_value = .5
        area('Review soft key', (-1.5, -2, 3), 180, 2.3, (1, .91, .80))
        area('Review sea fill', (2, -.5, 1.7), 100, 2, (.61, .81, 1))
        area('Review rear softbox', (0, 2, 2), 140, 1.8, (.80, .92, 1))
        data = bpy.data.cameras.new('Review only | camera')
        camera = bpy.data.objects.new('Review only | camera', data)
        scene.collection.objects.link(camera)
        camera.location = (.85, -2.6 if side == 'front' else 2.6, .95)
        camera.rotation_euler = (-camera.location).to_track_quat('-Z', 'Y').to_euler()
        data.type, data.ortho_scale = 'ORTHO', 1.12
        scene.camera = camera
        scene.render.engine = 'CYCLES'
        scene.cycles.samples = 16
        scene.cycles.use_denoising = True
        scene.render.threads_mode, scene.render.threads = 'FIXED', 2
        scene.render.resolution_x = scene.render.resolution_y = 512
        scene.render.resolution_percentage = 100
        scene.view_settings.view_transform = 'AgX'
        scene.render.image_settings.file_format = 'PNG'
        scene.render.filepath = str(out / f'magnet-{side}.png')
        bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--replace-owned', action='store_true')
    parser.add_argument('--review-dir', type=Path, help='Only re-import GLB and render into a NEW directory')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    if args.review_dir:
        review(args.review_dir)
        return
    if not args.replace_owned and any(p.exists() for p in (GLB, BLEND)):
        raise RuntimeError('Output already exists; inspect ownership before --replace-owned')
    for p in (GLB, BLEND):
        p.parent.mkdir(parents=True, exist_ok=True)
    build()


if __name__ == '__main__':
    main()
