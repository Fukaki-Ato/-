"""Re-import delivered GLBs, then render six equipment studies from two sides."""
import argparse
import math
import sys
from array import array
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
NAMES = ['shield', 'jetpack', 'board', 'multiplier', 'boots', 'helmet']


def contact_sheets(out):
    # Blender itself assembles PNG studies; no Pillow or external imaging install.
    for side in ['front', 'rear']:
        destination = out/f'contact-{side}.png'
        if destination.exists():
            raise RuntimeError(f'Refusing to replace existing review sheet: {destination}')
        studies = [bpy.data.images.load(str(out/f'{name}-{side}.png'), check_existing=False) for name in NAMES]
        w,h = studies[0].size
        pixels = array('f', [0])*(w*3*h*2*4)
        for i, image in enumerate(studies):
            source = array('f', [0])*(w*h*4)
            image.pixels.foreach_get(source)
            col,row = i%3, 1-i//3
            for y in range(h):
                a=((row*h+y)*w*3+col*w)*4
                pixels[a:a+w*4]=source[y*w*4:(y+1)*w*4]
        sheet=bpy.data.images.new('Coastal equipment '+side, width=w*3, height=h*2, alpha=True)
        sheet.pixels.foreach_set(pixels)
        sheet.filepath_raw=str(destination)
        sheet.file_format='PNG'
        sheet.save()
        for image in studies+[sheet]:
            bpy.data.images.remove(image)


def area(name, position, power, size, color):
    d = bpy.data.lights.new(name, 'AREA')
    d.energy = power
    d.shape = 'DISK'
    d.size = size
    d.color = color
    o = bpy.data.objects.new(name, d)
    bpy.context.collection.objects.link(o)
    o.location = position
    o.rotation_euler = (-o.location).to_track_quat('-Z', 'Y').to_euler()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--names', nargs='+', choices=NAMES, default=NAMES)
    parser.add_argument('--sides', nargs='+', choices=['front','rear'], default=['front','rear'])
    parser.add_argument('--sheets-only', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    out = Path(args.output_dir)
    if args.sheets_only:
        contact_sheets(out)
        return
    out.mkdir(parents=True, exist_ok=False)
    for name in args.names:
        for side in args.sides:
            bpy.ops.wm.read_factory_settings(use_empty=True)
            bpy.ops.import_scene.gltf(filepath=str(ROOT/'assets/pickups/coastal'/f'{name}.glb'))
            mesh_objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']
            bottom = min((o.matrix_world @ Vector(v)).z for o in mesh_objects for v in o.bound_box)
            bpy.ops.mesh.primitive_plane_add(size=200, location=(0,0,bottom-.015))
            ground=bpy.context.object
            mat=bpy.data.materials.new('Studio sand')
            mat.diffuse_color=(.13,.19,.225,1)
            ground.data.materials.append(mat)
            scene=bpy.context.scene
            scene.world=bpy.data.worlds.new('Coastal overcast')
            scene.world.use_nodes=True
            scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.30,.40,.52,1)
            scene.world.node_tree.nodes['Background'].inputs[1].default_value=.5
            area('Soft key',(-1.5,-2,3),180,2.3,(1,.91,.80))
            area('Sea fill',(2,-.5,1.7),100,2,(.61,.81,1))
            area('Rear softbox',(0,2,2),140,1.8,(.80,.92,1))
            d=bpy.data.cameras.new('Object study')
            camera=bpy.data.objects.new('Object study',d)
            scene.collection.objects.link(camera)
            camera.location=(.9,-2.4 if side=='front' else 2.4,1.10)
            camera.rotation_euler=(-camera.location).to_track_quat('-Z','Y').to_euler()
            d.type='ORTHO'
            d.ortho_scale=1.10
            scene.camera=camera
            scene.render.engine='CYCLES'
            scene.cycles.samples=16
            scene.cycles.use_denoising=True
            scene.render.threads_mode='FIXED'
            scene.render.threads=2
            scene.render.resolution_x=512
            scene.render.resolution_y=512
            scene.render.resolution_percentage=100
            scene.view_settings.view_transform='AgX'
            scene.render.image_settings.file_format='PNG'
            scene.render.filepath=str(out/f'{name}-{side}.png')
            bpy.ops.render.render(write_still=True)
    if args.names == NAMES and args.sides == ['front','rear']:
        contact_sheets(out)


if __name__=='__main__':
    main()
