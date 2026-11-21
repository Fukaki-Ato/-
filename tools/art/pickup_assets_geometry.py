"""Small opaque, texture-free coastal equipment modelling vocabulary (Blender)."""
import bpy
import math
from mathutils import Vector

PARTS = []
MATS = []


def material(name, color, metallic=0, roughness=.36):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bs = m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*color, 1)
    bs.inputs['Metallic'].default_value = metallic
    bs.inputs['Roughness'].default_value = roughness
    return m


def palette(accent):
    global MATS, PARTS
    PARTS = []
    MATS = [material('Porcelain | salt ivory', (.88, .91, .84)),
            material('Marine | deep enamel', (.025, .105, .17)),
            material('Brushed aluminium', (.40, .56, .62), .72, .28),
            material('Signal | equipment accent', accent, .15, .3)]


def finish(o, name, mat=0, smooth=False):
    o.name = name
    o.data.materials.clear()
    o.data.materials.append(MATS[mat])
    for p in o.data.polygons:
        p.use_smooth = smooth
    PARTS.append(o)
    return o


def mesh(name, verts, faces, mat=0, smooth=False):
    d = bpy.data.meshes.new(name)
    d.from_pydata(verts, [], faces)
    d.update()
    o = bpy.data.objects.new(name, d)
    bpy.context.collection.objects.link(o)
    return finish(o, name, mat, smooth)


def box(name, loc, size, mat=0, bevel=.015, rot=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = o.modifiers.new('Machined edge', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if rot:
        o.rotation_euler = rot
    return finish(o, name, mat)


def sphere(name, loc, scale, mat=0, segments=16, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=1, location=loc)
    o = bpy.context.object
    o.scale = scale
    return finish(o, name, mat, True)


def cylinder(name, a, b, radius, mat=0, segments=12, radius2=None):
    a, b = Vector(a), Vector(b)
    bpy.ops.mesh.primitive_cone_add(vertices=segments, radius1=radius,
                                  radius2=radius if radius2 is None else radius2,
                                  depth=(b-a).length, location=(a+b)/2)
    o = bpy.context.object
    o.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
    return finish(o, name, mat, True)


def ring(name, loc, radius, tube, mat=2, rot=(0, 0, 0), major=24, minor=5):
    bpy.ops.mesh.primitive_torus_add(major_segments=major, minor_segments=minor,
                                   location=loc, major_radius=radius, minor_radius=tube)
    o = bpy.context.object
    o.rotation_euler = rot
    return finish(o, name, mat, True)


def path(name, points, radius, mat, sides=6):
    # Real solid tube topology, no curves/export-time plugins.
    vertices = []
    for i, point in enumerate(points):
        p = Vector(point)
        tangent = Vector(points[min(i+1, len(points)-1)]) - Vector(points[max(0, i-1)])
        tangent.normalize()
        u = tangent.cross(Vector((0, 1, 0)))
        if u.length < .01:
            u = tangent.cross(Vector((1, 0, 0)))
        u.normalize()
        v = tangent.cross(u).normalized()
        vertices.extend(tuple(p + radius*(u*math.cos(j*math.tau/sides)+v*math.sin(j*math.tau/sides))) for j in range(sides))
    faces = [tuple(range(sides-1, -1, -1))]
    for i in range(len(points)-1):
        for j in range(sides):
            a = i*sides+j
            b = i*sides+(j+1)%sides
            faces.append((a, b, b+sides, a+sides))
    faces.append(tuple((len(points)-1)*sides+j for j in range(sides)))
    return mesh(name, vertices, faces, mat, True)


def plate(name, outline, depth, y, mat):
    # Front-facing extruded polygon in X/Z. Front is -Y (glTF +Z).
    n = len(outline)
    verts = [(x, y-depth/2, z) for x, z in outline] + [(x, y+depth/2, z) for x, z in outline]
    faces = [tuple(range(n-1, -1, -1)), tuple(range(n, 2*n))]
    faces += [(i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n)]
    return mesh(name, verts, faces, mat)


def screw(loc, axis=(0, -.012, 0)):
    a = Vector(loc)
    cylinder('Recessed marine fastener', a, a+Vector(axis), .012, 2, 6)


def join_center(name):
    bpy.ops.object.select_all(action='DESELECT')
    for p in PARTS:
        p.select_set(True)
    bpy.context.view_layer.objects.active = PARTS[0]
    bpy.ops.object.join()
    o = bpy.context.object
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    # Join can retain repeated material slots: remap to exactly four batches.
    old = list(o.data.materials)
    indices = [MATS.index(old[p.material_index]) for p in o.data.polygons]
    o.data.materials.clear()
    for m in MATS:
        o.data.materials.append(m)
    for p, index in zip(o.data.polygons, indices):
        p.material_index = index
    world = [o.matrix_world @ v.co for v in o.data.vertices]
    center = Vector(tuple((min(p[i] for p in world)+max(p[i] for p in world))/2 for i in range(3)))
    for v, p in zip(o.data.vertices, world):
        v.co = p-center
    o.location = (0, 0, 0)
    o.name = name
    o.data.name = name+' | batched topology'
    o['source'] = 'Original coastal club equipment; tools/art/pickup_assets*.py'
    o['anchor'] = 'AABB center, metres; engine applies PICKUP_CENTER_Y'
    return o
