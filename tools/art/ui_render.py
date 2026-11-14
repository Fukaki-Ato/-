#!/usr/bin/env python3
"""Compile the exported UI GLSL in software OpenGL/EGL; no layout recreation, DOM or HTTP."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re

os.environ.setdefault('LIBGL_ALWAYS_SOFTWARE', '1')
import moderngl
import numpy as np
from PIL import Image


def shader(source, stage, defines):
    # Equivalent Three ShaderMaterial builtins, with desktop GLSL330 syntax only.
    source = re.sub(r'^\s*#(?:version|extension)[^\n]*', '', source, flags=re.M)
    source = re.sub(r'\bprecision\s+\w+\s+\w+\s*;', '', source)
    source = re.sub(r'\b(?:lowp|mediump|highp)\b', '', source)
    source = re.sub(r'\bvarying\b', 'out' if stage == 'vertex' else 'in', source)
    source = re.sub(r'\battribute\b', 'in', source)
    source = source.replace('texture2D(', 'texture(').replace('textureCube(', 'texture(')
    source = source.replace('gl_FragColor', 'uiFragment')
    prefix = '#version 330\n' + ''.join(f'#define {k} {v}\n' for k, v in defines.items())
    if stage == 'vertex':
        prefix += '''in vec3 position; in vec2 uv; in vec3 normal;
uniform mat4 modelMatrix, modelViewMatrix, viewMatrix, projectionMatrix;
uniform mat3 normalMatrix;\n'''
    else:
        prefix += 'out vec4 uiFragment;\n'
    return prefix + source


def flatten(value):
    if isinstance(value, list):
        return [item for child in value for item in flatten(child)]
    return [value]


def set_uniform(program, name, value):
    if name not in program:  # GLSL can optimize unused uniforms/attributes away.
        return
    target = program[name]
    if isinstance(value, list):
        # Three arrays and matrices are column-major; ModernGL writes preserve that byte order.
        values = flatten(value)
        target.write(np.asarray(values[:target.array_length * target.dimension], dtype='f4').tobytes())
    elif value is not None:
        target.value = value


def load_texture(ctx, entry):
    if entry['colorSpace'] != '' or entry['premultiplyAlpha']:
        raise ValueError('Only the shared UI NoColorSpace/non-premultiplied source contract is supported')
    if 'path' in entry:
        path = Path(entry['path'])
        if hashlib.sha256(path.read_bytes()).hexdigest() != entry['sha256']:
            raise ValueError(f'Texture changed after snapshot: {path}; recapture JSON')
        image = Image.open(path).convert('RGBA')
    else:
        image = Image.frombytes('RGBA', (entry['width'], entry['height']), base64.b64decode(entry['rgba']))
    if entry['flipY']:
        image = image.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    # OpenGL row zero receives PNG TOP row. flipY=false UI UV y=0 means the top row.
    texture = ctx.texture(image.size, 4, image.tobytes(), alignment=1)
    filters = {1003: moderngl.NEAREST, 1004: moderngl.NEAREST_MIPMAP_NEAREST,
               1005: moderngl.NEAREST_MIPMAP_LINEAR, 1006: moderngl.LINEAR,
               1007: moderngl.LINEAR_MIPMAP_NEAREST, 1008: moderngl.LINEAR_MIPMAP_LINEAR}
    if entry['generateMipmaps']:
        texture.build_mipmaps()
    texture.filter = (filters[entry['minFilter']], filters[entry['magFilter']])
    if entry['wrapS'] not in (1000, 1001) or entry['wrapT'] not in (1000, 1001):
        raise ValueError('Unsupported texture wrap mode')
    texture.repeat_x = entry['wrapS'] == 1000
    texture.repeat_y = entry['wrapT'] == 1000
    return texture


def render(ctx, snapshot, textures, width, height, samples):
    color = ctx.renderbuffer((width, height), components=4, samples=samples)
    depth = ctx.depth_renderbuffer((width, height), samples=samples)
    frame = ctx.framebuffer(color, depth)
    frame.use()
    ctx.viewport = (0, 0, width, height)
    background = snapshot['background']
    frame.clear(*background[:3], background[3] if len(background) == 4 else 1)
    programs = {}
    for draw in snapshot['draws']:
        key = (draw['vertexShader'], draw['fragmentShader'], json.dumps(draw['defines'], sort_keys=True))
        if key not in programs:
            programs[key] = ctx.program(vertex_shader=shader(key[0], 'vertex', draw['defines']),
                                        fragment_shader=shader(key[1], 'fragment', draw['defines']))
        program = programs[key]
        set_uniform(program, 'modelMatrix', draw['matrixWorld'])
        set_uniform(program, 'viewMatrix', snapshot['camera']['viewMatrix'])
        set_uniform(program, 'projectionMatrix', snapshot['camera']['projectionMatrix'])
        model = np.asarray(draw['matrixWorld']).reshape((4, 4), order='F')
        view = np.asarray(snapshot['camera']['viewMatrix']).reshape((4, 4), order='F')
        model_view = view @ model
        set_uniform(program, 'modelViewMatrix', model_view.flatten(order='F').tolist())
        set_uniform(program, 'normalMatrix', np.linalg.inv(model_view[:3, :3]).T.flatten(order='F').tolist())
        unit = 0
        for name, value in draw['uniforms'].items():
            if isinstance(value, dict) and 'texture' in value:
                textures[value['texture']].use(unit)
                set_uniform(program, name, unit)
                unit += 1
            else:
                set_uniform(program, name, value)
        ctx.enable(moderngl.BLEND) if draw['transparent'] else ctx.disable(moderngl.BLEND)
        ctx.blend_func = (moderngl.ONE if draw['premultipliedAlpha'] else moderngl.SRC_ALPHA,
                          moderngl.ONE_MINUS_SRC_ALPHA, moderngl.ONE, moderngl.ONE_MINUS_SRC_ALPHA)
        ctx.enable(moderngl.DEPTH_TEST) if draw['depthTest'] else ctx.disable(moderngl.DEPTH_TEST)
        ctx.depth_mask = draw['depthWrite']
        ctx.depth_func = '<='
        ctx.enable(moderngl.CULL_FACE) if draw['side'] != 2 else ctx.disable(moderngl.CULL_FACE)
        ctx.cull_face = 'back' if draw['side'] == 0 else 'front'
        buffers, bindings = [], []
        for name, attr in draw['attributes'].items():
            if name not in program:
                continue
            buffer = ctx.buffer(np.asarray(attr['values'], dtype='f4').tobytes())
            buffers.append(buffer)
            bindings.append((buffer, f"{attr['itemSize']}f", name))
        index = ctx.buffer(np.asarray(draw['indices'], dtype='u4').tobytes())
        vao = ctx.vertex_array(program, bindings, index, index_element_size=4)
        vao.render(moderngl.TRIANGLES)
        vao.release(); index.release()
        for buffer in buffers:
            buffer.release()
    target = ctx.simple_framebuffer((width, height), components=4)
    ctx.copy_framebuffer(target, frame)
    image = Image.frombytes('RGBA', (width, height), target.read(components=4, alignment=1))
    image = image.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    target.release(); frame.release(); depth.release(); color.release()
    for program in programs.values():
        program.release()
    return image, len(programs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('out', type=Path, help='New PNG; existing paths are never overwritten')
    parser.add_argument('--samples', type=int, default=4, choices=[0, 2, 4, 8])
    args = parser.parse_args()
    snapshot = json.loads(args.snapshot.read_text())
    viewport = snapshot['metadata']['viewport']
    ctx = moderngl.create_standalone_context(require=330, backend='egl')
    textures = [load_texture(ctx, entry) for entry in snapshot['textures']]
    image, count = render(ctx, snapshot, textures, viewport['width'], viewport['height'], args.samples)
    # Exclusive creation at the actual write boundary, including metadata.
    with args.out.open('xb') as handle:
        image.save(handle, format='PNG')
    pixels = np.asarray(image)
    report = {'mode': 'offline/sample', 'renderer': ctx.info['GL_RENDERER'], 'GL': ctx.info['GL_VERSION'],
              'shaderProgramsCompiled': count, 'draws': len(snapshot['draws']), 'samples': args.samples,
              'uniqueRGB': len(np.unique(pixels[:, :, :3].reshape(-1, 3), axis=0)),
              'alphaMinMax': [int(pixels[:, :, 3].min()), int(pixels[:, :, 3].max())],
              'snapshot': str(args.snapshot.resolve()), 'png': str(args.out.resolve()),
              'limits': 'Software OpenGL UI observation only; not WebGL/WX/devtools/device/performance acceptance'}
    with args.out.with_suffix('.png.json').open('x') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    print(json.dumps(report, ensure_ascii=False))
    ctx.release()


if __name__ == '__main__':
    main()
