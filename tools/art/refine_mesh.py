"""Geometry-level clothing/trim work, then vertex-colour batching for mobile GLB.

Existing silhouette, face and bind skin are retained. Original GLBs are inputs only.
"""
import bpy
import math
from mathutils import Vector


def material(name, color, roughness=.7):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = roughness
    return mat


def bind(obj, rig, bone):
    obj.parent = rig
    group = obj.vertex_groups.new(name=bone)
    group.add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
    modifier = obj.modifiers.new('Skin', 'ARMATURE')
    modifier.object = rig
    return obj


def rings(name, profile, mat, rig, bone, x=0, y=0, segments=20, folds=0):
    verts, faces = [], []
    for z, rx, ry in profile:
        for i in range(segments):
            angle = i / segments * math.tau
            ripple = 1 + folds * math.cos(angle * 8)
            verts.append((x + rx * math.cos(angle)*ripple, y + ry * math.sin(angle)*ripple, z))
    for k in range(len(profile)-1):
        for i in range(segments):
            a, b = k*segments+i, k*segments+(i+1)%segments
            faces.append((a, b, b+segments, a+segments))
    faces += [tuple(reversed(range(segments))), tuple(range((len(profile)-1)*segments, len(profile)*segments))]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    bind(obj, rig, bone)
    return obj


def seam(name, points, radius, mat, rig, bone):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.resolution_u = 1
    curve.bevel_depth, curve.bevel_resolution = radius, 1
    spline = curve.splines.new('POLY')
    spline.points.add(len(points)-1)
    for point, co in zip(spline.points, points):
        point.co = (*co, 1)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')
    return bind(obj, rig, bone)


def ellipsoid(name, center, radii, mat, rig, bone):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, location=center)
    obj = bpy.context.object
    obj.name, obj.scale = name, radii
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.data.materials.append(mat)
    for face in obj.data.polygons:
        face.use_smooth = True
    return bind(obj, rig, bone)


def refine_geometry(name, rig):
    rig.data.pose_position = 'REST'
    cream = material('Coastal ivory stitching', (.88, .84, .7))
    ink = material('Coastal ink piping', (.07, .09, .16))
    gold = material('Coastal warm brass', (.67, .38, .09), .34)
    if name == 'bball':
        # Replace the old overlapping front/back tank and one-piece skirt-like shorts.
        for key in ['Body', 'Jersey', 'JerseyBack', 'Shorts', 'SleeveL', 'SleeveR', 'SleeveCuffL', 'SleeveCuffR',
                    'SockL', 'SockR', 'KneebandL', 'KneebandR']:
            bpy.data.objects.remove(bpy.data.objects[key], do_unlink=True)
        yellow = material('Woven saffron kit', (.92, .48, .025))
        purple = material('Violet team trim', (.17, .06, .29))
        top = rings('Sculpted jersey', [(.82,.151,.12),(.9,.155,.126),(1.04,.176,.127),
                    (1.19,.18,.12),(1.28,.16,.102),(1.31,.095,.081)], yellow, rig, 'Chest', folds=.022)
        top.vertex_groups.clear()
        spine, chest = (top.vertex_groups.new(name=n) for n in ('Spine', 'Chest'))
        for v in top.data.vertices:
            t = min(1, max(0, (v.co.z-.88)/.23))
            if t < 1: spine.add([v.index], 1-t, 'REPLACE')
            if t > 0: chest.add([v.index], t, 'REPLACE')
        rings('Collar binding', [(1.297,.101,.086),(1.315,.096,.082)], purple, rig, 'Chest')
        skin = bpy.data.materials['MSkin']
        rings('Neck bridge', [(1.29,.052,.052),(1.42,.057,.057)], skin, rig, 'Neck')
        rings('Elastic waistband', [(.80,.245,.13),(.845,.24,.13)], purple, rig, 'Hips')
        for side, x in [('L',.122),('R',-.122)]:
            sign = 1 if x > 0 else -1
            ellipsoid('Rounded shoulder '+side, (sign*.186,0,1.34), (.075,.077,.07), skin, rig, 'Chest')
            seam('Tank shoulder binding '+side, [(sign*.084,-.078,1.31),(sign*.133,-.066,1.35),
                 (sign*.183,0,1.392),(sign*.13,.068,1.35),(sign*.084,.078,1.31)], .017, purple, rig, 'Chest')
            rings('Tailored shorts '+side, [(.56,.105,.119),(.62,.111,.126),(.76,.12,.129),(.825,.117,.127)],
                  yellow, rig, 'LegUpper'+side, x=x, folds=.018)
            rings('Shorts binding '+side, [(.555,.107,.121),(.577,.109,.124)], purple, rig, 'LegUpper'+side, x=x)
            rings('Athletic ankle sock '+side, [(.11,.057,.057),(.23,.059,.057),(.245,.061,.059)], cream, rig, 'LegLower'+side, x=sign*.185)
            seam('Jersey side seam '+side, [(x*1.22,-.079,.86),(x*1.4,-.081,1.02),(x*1.43,-.07,1.2)], .006, purple, rig, 'Chest')
        # The face uses -Y in this original asset; the whole skin is oriented on export.
        seam('Chest lightning embroidery', [(-.035,-.137,1.22),(.015,-.139,1.22),(-.014,-.142,1.16),(.034,-.138,1.17),(-.018,-.138,1.10)],
             .008, cream, rig, 'Chest')
    elif name == 'frog':
        body = bpy.data.objects['Body']
        bpy.context.view_layer.objects.active = body
        decimate = body.modifiers.new('Silhouette-preserving mobile surface', 'DECIMATE')
        decimate.ratio = .58
        bpy.ops.object.modifier_apply(modifier=decimate.name)
        # Sculpted eye-rim geometry makes the existing large eyes readable in shade.
        for side in ('L', 'R'):
            eye = bpy.data.objects['Eye'+side]
            verts = [eye.matrix_world @ v.co for v in eye.data.vertices]
            center = sum(verts, Vector()) / len(verts)
            rx = (max(v.x for v in verts)-min(v.x for v in verts))*.49
            z = center.z
            y = max(v.y for v in verts)
            seam('Upper eye rim '+side, [(center.x + rx*math.cos(i*math.pi/12), y-.008, z+.07*math.sin(i*math.pi/12)) for i in range(13)],
                 .009, ink, rig, 'Head')
    elif name == 'niu':
        red = material('Coral neckerchief', (.66,.10,.075))
        rings('Folded club kerchief', [(.86,.218,.205),(.89,.22,.21),(.925,.185,.17)], red, rig, 'Chest', folds=.03)
        seam('Kerchief folded edge', [(-.13,.20,.89),(0,.245,.77),(.13,.20,.89)], .009, cream, rig, 'Chest')
        for side in ('L','R'):
            # The legacy eye ellipsoids sat on top of the head. Rebuild them on the face.
            for prefix in ('Eye', 'Lid', 'Brow'):
                bpy.data.objects.remove(bpy.data.objects[prefix+side], do_unlink=True)
            x = -.085 if side == 'L' else .085
            ellipsoid('Eye sclera '+side, (x,.198,1.145), (.047,.021,.061), cream, rig, 'Head')
            ellipsoid('Eye iris '+side, (x,.220,1.143), (.024,.011,.034), ink, rig, 'Head')
            ellipsoid('Eye glint '+side, (x-.007,.231,1.159), (.008,.004,.010), cream, rig, 'Head')
            seam('Expressive brow '+side, [(x-.044,.198,1.209),(x,.210,1.218),(x+.039,.199,1.209)], .008, ink, rig, 'Head')
            hoof = bpy.data.objects['Foot'+side]
            center = sum((v.co for v in hoof.data.vertices), Vector())/len(hoof.data.vertices)
            seam('Hoof cleft '+side, [(center.x,.095,.015),(center.x,.095,.055)], .004, ink, rig, 'Foot'+side)
    else:
        # Re-cut the dress silhouette with small alternating pleats; keep original trim/UV.
        dress = bpy.data.objects['Dress']
        zmin = min(v.co.z for v in dress.data.vertices)
        zmax = max(v.co.z for v in dress.data.vertices)
        for v in dress.data.vertices:
            influence = 1-(v.co.z-zmin)/(zmax-zmin)
            ripple = 1+.035*influence*math.cos(math.atan2(v.co.y,v.co.x)*16)
            v.co.x *= ripple
            v.co.y *= ripple
        # The hem follows the corresponding thigh a little instead of clipping through it.
        for obj in [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name in ('Dress','SkirtFrill','Apron','ApronFrill')]:
            hips = obj.vertex_groups.get('Hips') or obj.vertex_groups.new(name='Hips')
            groups = {side: obj.vertex_groups.get('LegUpper'+side) or obj.vertex_groups.new(name='LegUpper'+side) for side in ('L','R')}
            for v in obj.data.vertices:
                if v.co.z > zmin + (zmax-zmin)*.6:
                    continue
                weight = min(.42, max(0, (1-(v.co.z-zmin)/(zmax-zmin))*.42))
                side = min(('L','R'), key=lambda s: abs(v.co.x-rig.data.bones['LegUpper'+s].head_local.x))
                for group in obj.vertex_groups:
                    group.remove([v.index])
                hips.add([v.index], 1-weight, 'REPLACE')
                groups[side].add([v.index], weight, 'REPLACE')
        for side in ('L','R'):
            foot = rig.data.bones['Foot'+side].head_local
            front = .071 if name == 'pony' else .055
            for level in range(3):
                seam('Boot stitch '+side+str(level), [(foot.x-.022,front,.04+level*.012),(foot.x+.022,front,.047+level*.012)],
                     .0028, cream, rig, 'Foot'+side)
        if name == 'whale':
            seam('Apron scallop embroidery', [(-.13,.245,.32),(-.07,.268,.30),(0,.275,.32),(.07,.268,.30),(.13,.245,.32)],
                 .004, gold, rig, 'Hips')
    rig.data.pose_position = 'POSE'


def batch_materials(rig):
    """Bake constant base colours into vertices, keep texture-bearing materials intact."""
    shared = {}
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH'
              and any(m.type == 'ARMATURE' and m.object == rig for m in o.modifiers)]
    for obj in meshes:
        colors = obj.data.color_attributes.get('CoastalColor') or obj.data.color_attributes.new(name='CoastalColor', type='FLOAT_COLOR', domain='CORNER')
        old = list(obj.data.materials)
        replacement = []
        for mat in old:
            shader = mat.node_tree.nodes.get('Principled BSDF') if mat and mat.use_nodes else None
            textured = shader and shader.inputs['Base Color'].is_linked
            if textured:
                replacement.append(mat)
                continue
            rough = shader.inputs['Roughness'].default_value if shader else .7
            bucket = 'satin' if rough < .4 else 'matte'
            if bucket not in shared:
                value = material('Coastal vertex '+bucket, (1,1,1), .32 if bucket=='satin' else .72)
                color_node = value.node_tree.nodes.new('ShaderNodeVertexColor')
                color_node.layer_name = 'CoastalColor'
                value.node_tree.links.new(color_node.outputs['Color'], value.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
                shared[bucket] = value
            replacement.append(shared[bucket])
        for polygon in obj.data.polygons:
            mat = old[polygon.material_index]
            shader = mat.node_tree.nodes.get('Principled BSDF') if mat.use_nodes else None
            base = shader.inputs['Base Color'].default_value[:] if shader else mat.diffuse_color[:]
            if replacement[polygon.material_index] == mat:
                base = (1,1,1,1)
            for index in polygon.loop_indices:
                colors.data[index].color = base
        for i, mat in enumerate(replacement):
            obj.data.materials[i] = mat
    bpy.ops.object.select_all(action='DESELECT')
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    joined = bpy.context.object
    joined.name = 'Coastal skinned character'
    return joined
