"""Rebuild the four original, editable coastal-club characters in Blender 4.5.

LD_LIBRARY_PATH=<portable-libs> blender -b -t 2 --python tools/art/new_roster.py -- ama
Omit the ID to build all four sequentially. Outputs are task-owned; no external assets.
"""
import bpy
import json
import math
import sys
from pathlib import Path
from mathutils import Vector, Quaternion

sys.dont_write_bytecode=True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from new_roster_mesh import Draft, build_body, build_style
from refine_motion import author_motion

ROOT = Path(__file__).resolve().parents[2]
PALETTES = {
    'ama': ['#A86644','#6B3831','#30252B','#1F3841','#FFF0CD','#65D8B6','#E8AF48','#FFFBF1','#3B7370','#9CF9DE'],
    'kaze':['#E9B48B','#A46354','#253B58','#1D304A','#E9F6F7','#75CAEB','#CFAD65','#FFFCF2','#36768F','#B8FAFF'],
    'rina':['#EFBD99','#AF6B5C','#94483B','#453C4B','#FFEBCA','#E98277','#D9AB59','#FFFDF6','#568C9D','#BCEDFC'],
    'bolt':['#D5AC96','#98695E','#292B42','#24263A','#D8D7E3','#8C79C5','#D9BD77','#FFF9EF','#8B7CC5','#C6E5FF'],
}
LABELS = {'ama':'Amara / 阿玛拉','kaze':'Kaze / 风剃','rina':'Rina / 莉娜','bolt':'Chrono / 时空行者'}


def material(name, hexcolor, metallic=0):
    rgb=[int(hexcolor[i:i+2],16)/255 for i in (1,3,5)]
    linear=[c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in rgb]
    m=bpy.data.materials.new(name)
    m.diffuse_color=(*linear,1)
    m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*linear,1)
    p.inputs['Roughness'].default_value=.72 if metallic==0 else .38
    p.inputs['Metallic'].default_value=metallic
    return m


def rig_create(key):
    data=bpy.data.armatures.new('Coastal anatomical skeleton')
    rig=bpy.data.objects.new('Coastal_'+key, data)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active=rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    def bone(name,head,tail,parent=None):
        b=data.edit_bones.new(name)
        b.head,b.tail=head,tail
        if parent: b.parent=data.edit_bones[parent]
    bone('Root',(0,0,0),(0,0,.18))
    bone('Hips',(0,0,.84),(0,0,.96),'Root')
    bone('Spine',(0,0,.96),(0,0,1.11),'Hips')
    bone('Chest',(0,0,1.11),(0,0,1.28),'Spine')
    bone('Neck',(0,0,1.28),(0,0,1.36),'Chest')
    bone('Head',(0,0,1.36),(0,0,1.61),'Neck')
    for s,side in [(-1,'R'),(1,'L')]:
        bone('ArmUpper'+side,(s*.213,0,1.247),(s*.307,0,1.05),'Chest')
        bone('ArmLower'+side,(s*.307,0,1.05),(s*.346,0,.845),'ArmUpper'+side)
        bone('Hand'+side,(s*.346,0,.845),(s*.356,0,.77),'ArmLower'+side)
        bone('LegUpper'+side,(s*.095,0,.835),(s*.105,0,.46),'Hips')
        bone('LegLower'+side,(s*.105,0,.46),(s*.105,0,.15),'LegUpper'+side)
        bone('Foot'+side,(s*.105,0,.15),(s*.105,-.11,.07),'LegLower'+side)
        if key=='rina':
            bone('Wing'+side,(s*.09,.14,1.21),(s*.2,.17,.97),'Chest')
        if key=='kaze':
            bone('Scarf'+side,(s*.04,.069,1.285),(s*.18,.21,1.08),'Chest')
        if key=='bolt':
            bone('Coat'+side,(s*.10,0,.92),(s*.17,.05,.63),'Hips')
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig


def rotations(rig, values):
    for name,angles in values.items():
        b=rig.pose.bones[name]
        basis=b.bone.matrix_local.to_quaternion()
        q=Quaternion((1,0,0),math.radians(angles[0])) @ Quaternion((0,1,0),math.radians(angles[1])) @ Quaternion((0,0,1),math.radians(angles[2]))
        b.rotation_quaternion=basis.inverted() @ q @ basis


def pose(clip,t,key):
    """Original full-body poses, anatomical X flexion, modest sport exaggeration."""
    a=math.tau*t
    p={}
    lift=0
    def setr(b,x=0,y=0,z=0): p[b]=(x,y,z)
    for side in ['L','R']:
        setr('ArmUpper'+side,0,0,-5 if side=='L' else 5)
        setr('ArmLower'+side,-8)
    if clip=='Run':
        setr('Spine',9)
        setr('Chest',3,0,3*math.sin(a))
        setr('Head',-8)
        for phase,side in [(a,'L'),(a+math.pi,'R')]:
            # Forward thigh to 39°, recovery knee folds to ~86°, arms counter-swing.
            forward=math.sin(phase)
            setr('LegUpper'+side,-6-38*forward)
            setr('LegLower'+side,16+68*max(0,-math.cos(phase))**1.4)
            setr('Foot'+side,-9-10*math.sin(phase+.6))
            setr('ArmUpper'+side,30*forward-4,0,-6 if side=='L' else 6)
            setr('ArmLower'+side,-48-12*max(0,-forward))
        lift=.018*(1-math.cos(a*2))
    elif clip in ['Idle','Wave']:
        setr('Chest',1.2*math.sin(a))
        setr('Head',0,0,2*math.sin(a))
        setr('ArmUpperL',2*math.sin(a),0,-5)
        setr('ArmUpperR',-2*math.sin(a),0,5)
        if clip=='Wave':
            setr('ArmUpperL',-9,-143,0)
            setr('ArmLowerL',-28,-18+11*math.sin(a*2),0)
            setr('HandL',0,10*math.sin(a*2),0)
    elif clip=='Slide':
        setr('Spine',50)
        setr('Chest',22)
        setr('Head',-60)
        setr('LegUpperL',-95)
        setr('LegLowerL',140)
        setr('FootL',-20)
        setr('LegUpperR',-88)
        setr('LegLowerR',130)
        setr('FootR',-15)
        setr('ArmUpperL',-45,0,14)
        setr('ArmUpperR',-50,0,-12)
        setr('ArmLowerL',-60)
        setr('ArmLowerR',-40)
        setr('Chest',22+1.2*math.sin(a))
    elif clip=='Fly':
        setr('Spine',25)
        setr('Chest',12)
        setr('Head',-28)
        for s,side in [(1,'L'),(-1,'R')]:
            setr('ArmUpper'+side,-15,-s*(65+3*math.sin(a)),0)
            setr('ArmLower'+side,-10)
            setr('LegUpper'+side,12+3*math.sin(a+s))
            setr('LegLower'+side,31+5*math.sin(a+s))
            setr('Foot'+side,6)
    elif clip=='Jump':
        f=math.sin(math.pi*t)
        setr('Spine',10*f)
        setr('Head',-5*f)
        for side in ['L','R']:
            setr('LegUpper'+side,-32*f)
            setr('LegLower'+side,55*f)
            setr('Foot'+side,-12*f)
            setr('ArmUpper'+side,-65*f)
            setr('ArmLower'+side,-28*f)
    elif clip in ['TurnLeft','TurnRight']:
        f=math.sin(math.pi*t)
        s=1 if clip=='TurnLeft' else -1
        setr('Spine',7,-s*13*f,0)
        setr('Chest',0,-s*8*f,0)
        setr('Head',0,0,s*9*f)
        setr('ArmUpperL',-18*f,0,-12*f)
        setr('ArmUpperR',18*f,0,12*f)
        setr('LegUpperL',-18*f)
        setr('LegUpperR',12*f)
        setr('LegLowerL',24*f)
        setr('LegLowerR',18*f)
    elif clip=='Land':
        f=(1-t)**1.4
        setr('Spine',17*f)
        setr('Chest',8*f)
        setr('Head',-12*f)
        for side in ['L','R']:
            setr('LegUpper'+side,-34*f)
            setr('LegLower'+side,66*f)
            setr('Foot'+side,-20*f)
            setr('ArmUpper'+side,-18*f)
            setr('ArmLower'+side,-30*f)
    elif clip=='Hit':
        f=math.sin(math.pi*t)
        setr('Spine',-19*f)
        setr('Chest',-12*f)
        setr('Head',15*f)
        for s,side in [(1,'L'),(-1,'R')]:
            setr('ArmUpper'+side,35*f,0,s*20*f)
            setr('ArmLower'+side,-50*f)
            setr('LegUpper'+side,-12*f)
            setr('LegLower'+side,20*f)
    elif clip=='Death':
        f=t*t*(3-2*t)
        setr('Root',0,-78*f,0)
        setr('Spine',12*f)
        setr('Head',8*f)
        setr('LegUpperL',-30*f)
        setr('LegUpperR',12*f)
        setr('LegLowerL',58*f)
        setr('LegLowerR',37*f)
        setr('ArmUpperL',-35*f,0,24*f)
        setr('ArmUpperR',15*f,0,-18*f)
        setr('ArmLowerL',-44*f)
        setr('ArmLowerR',-26*f)
    if key=='rina':
        for s,side in [(1,'L'),(-1,'R')]:
            setr('Wing'+side,0,-s*(67 if clip=='Fly' else 2*math.sin(a)),s*(10 if clip=='Fly' else 0))
    if key=='kaze':
        for s,side in [(1,'L'),(-1,'R')]:
            setr('Scarf'+side,(-14 if clip=='Run' else 0)+5*math.sin(a+s),0,s*5*math.sin(a))
    if key=='bolt':
        for s,side in [(1,'L'),(-1,'R')]:
            angle=0
            if clip=='Run': angle=15*math.sin(a+(0 if s>0 else math.pi))
            if clip in ['Slide','Land','Jump']: angle=-25*(1 if clip=='Slide' else math.sin(math.pi*t))
            setr('Coat'+side,angle,0,s*3)
    return p,lift


def animate(rig,obj,key):
    scene=bpy.context.scene
    scene.render.fps=30
    rig.animation_data_create()
    durations={'Idle':2.4,'Run':.8,'Slide':1.2,'Jump':.7,'TurnLeft':.3,
               'TurnRight':.3,'Fly':1.6,'Land':.3,'Hit':.5,'Death':1.1,'Wave':2.0}
    for name,duration in durations.items():
        action=bpy.data.actions.new(name)
        rig.animation_data.action=action
        count=round(duration*30)
        for frame in range(count+1):
            t=frame/count
            scene.frame_set(frame)
            for b in rig.pose.bones:
                b.rotation_mode='QUATERNION'
                b.rotation_quaternion=(1,0,0,0)
                b.location=(0,0,0)
            values,lift=pose(name,t,key)
            rotations(rig,values)
            bpy.context.view_layer.update()
            # Contact correction uses the actual deformed mesh, not a guessed joint height.
            deps=bpy.context.evaluated_depsgraph_get()
            evaluated=obj.evaluated_get(deps)
            mesh=evaluated.to_mesh()
            floor=min((evaluated.matrix_world@v.co).z for v in mesh.vertices)
            evaluated.to_mesh_clear()
            root=rig.pose.bones['Root']
            shift=-floor+(.018 if name=='Fly' else lift)
            root.location=root.bone.matrix_local.to_3x3().inverted()@Vector((0,0,shift))
            for b in rig.pose.bones:
                b.keyframe_insert('rotation_quaternion',frame=frame,group=b.name)
            root.keyframe_insert('location',frame=frame,group='Root')
        # Export each named NLA track; no synthetic/renamed duplicate clips.
        track=rig.animation_data.nla_tracks.new()
        track.name=name
        track.strips.new(name,0,action)
        track.mute=True
    rig.animation_data.action=None
    # Friendly editable source opens in the calm idle pose.
    for tr in rig.animation_data.nla_tracks: tr.mute=tr.name!='Idle'
    scene.frame_set(0)
    scene.frame_end=72


def build(key):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene=bpy.context.scene
    scene['thunderMotionVersion']=2
    scene['originalDesign']='Original hand-authored coastal sporting club; no external source meshes or images'
    rig=rig_create(key)
    rig['thunderMotionVersion']=2
    rig['characterId']='char_'+key
    rig['designLabel']=LABELS[key]
    rig['frontAxis']='Blender +Y; glTF -Z'
    d=Draft()
    build_body(d,key)
    build_style(d,key)
    # Kaze's glide runner sits 12mm below shoe: lift the complete authored mesh/rig baseline.
    if key=='kaze':
        d.verts=[(x,y,z+.012) for x,y,z in d.verts]
    mesh=bpy.data.meshes.new(key+'_tailored_topology')
    mesh.from_pydata(d.verts,[],d.faces)
    mesh.update()
    obj=bpy.data.objects.new(key+'_skinned_character',mesh)
    bpy.context.collection.objects.link(obj)
    names=['Skin','Face shadow','Sculpted hair','Ink textile','Cream textile',
           'Club color','Brushed gold','Eye white','Iris glass','Device inlay']
    for i,(name,color) in enumerate(zip(names,PALETTES[key])):
        mesh.materials.append(material(name,color,.55 if i==6 else 0))
    for poly,mat in zip(mesh.polygons,d.mats):
        poly.material_index=mat
        poly.use_smooth=True
    for b in rig.data.bones: obj.vertex_groups.new(name=b.name)
    for i,weights in enumerate(d.weights):
        for bone,w in weights.items():
            if w>0: obj.vertex_groups[bone].add([i],w,'REPLACE')
    mod=obj.modifiers.new('True deforming anatomical skin','ARMATURE')
    mod.object=rig
    obj.parent=rig
    # Resolve all normals on the hand-authored closed surfaces.
    bpy.context.view_layer.objects.active=obj
    rig.select_set(False)
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    animate(rig,obj,key)
    # Contact/recovery IK removes the old FK take's two ground dips per foot/cycle.
    # Its front is still -Y here; the complete rig is oriented immediately below.
    author_motion(rig, forward=-1)
    # Draft coordinates use a convenient -Y facial plane; orient the complete
    # deforming rig to the project's +Y / glTF -Z front contract.
    rig.rotation_euler.z=math.pi
    source=ROOT/'art-source/coastal'/f'{key}.blend'
    target=ROOT/'assets/characters/coastal'/f'{key}.glb'
    source.parent.mkdir(parents=True,exist_ok=True)
    target.parent.mkdir(parents=True,exist_ok=True)
    # Disable versioned backup files, keeping reruns inside the assigned paths.
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(source))
    for track in rig.animation_data.nla_tracks: track.mute=False
    bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',
        export_animations=True,export_animation_mode='NLA_TRACKS',
        export_nla_strips=True,export_skins=True,export_def_bones=False,
        export_extras=True,export_yup=True,export_materials='EXPORT',
        export_cameras=False,export_lights=False,export_force_sampling=True,
        export_optimize_animation_size=True)
    mesh.calc_loop_triangles()
    print('COASTAL_RESULT',json.dumps({'id':key,'triangles':len(mesh.loop_triangles),
        'vertices':len(mesh.vertices),'bones':len(rig.data.bones),
        'clips':len(rig.animation_data.nla_tracks),'bytes':target.stat().st_size}))


if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    for key in args or PALETTES:
        if key not in PALETTES: raise ValueError(key)
        build(key)
