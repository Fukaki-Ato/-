#!/usr/bin/env python3
"""Focused offline pixel evidence: atlas text, unchanged portrait color/orientation, shader clipping."""
import argparse
import copy
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
from ui_render import Image, moderngl, np, load_texture, render


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path, help='Use a first-screen lobby snapshot with a portrait and clipped overflow')
    parser.add_argument('png', type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    source = json.loads(args.snapshot.read_text())
    width, height = (source['metadata']['viewport'][k] for k in ('width', 'height'))
    assert Image.open(args.png).size == (width, height)
    full = np.asarray(Image.open(args.png).convert('RGBA'))
    assert len(np.unique(full[:, :, :3].reshape(-1, 3), axis=0)) > 100
    ctx = moderngl.create_standalone_context(require=330, backend='egl')
    textures = [load_texture(ctx, item) for item in source['textures']]

    def layer(draws):
        snapshot = {**source, 'background': [0, 0, 0, 0], 'draws': draws}
        return np.asarray(render(ctx, snapshot, textures, width, height, 0)[0])

    # Real atlas shaders, not system font text. Verify opaque text RGB and visible top-title pixels.
    text_draws = [d for d in source['draws'] if 'uAtlas' in d['uniforms']]
    text = layer(text_draws)
    title = next(label for label in source['labels'] if label['rect']['y'] < 70 and len(label['text']) >= 4)
    r = title['rect']
    title_pixels = int(np.count_nonzero(text[int(r['y']):int(r['y'] + r['h']), int(r['x']):int(r['x'] + r['w']), 3]))
    assert title_pixels > 20
    first = text_draws[0]
    glyph = layer([first])
    opaque = glyph[:, :, 3] == 255
    assert np.count_nonzero(opaque) > 5
    color = np.asarray(first['uniforms']['uColor']) * 255
    text_error = float(np.max(np.abs(glyph[:, :, :3][opaque].astype(float) - color)))
    assert text_error <= 1

    portrait = next(d for d in source['draws'] if 'uMap' in d['uniforms'] and
                    '/portraits/' in source['textures'][d['uniforms']['uMap']['texture']].get('path', ''))
    texture_entry = source['textures'][portrait['uniforms']['uMap']['texture']]
    original = np.asarray(Image.open(texture_entry['path']).convert('RGBA'))
    portrait_layer = layer([portrait])
    p = np.asarray(portrait['attributes']['position']['values']).reshape(-1, 3)
    model = np.asarray(portrait['matrixWorld']).reshape((4, 4), order='F')
    view = np.asarray(source['camera']['viewMatrix']).reshape((4, 4), order='F')
    projection = np.asarray(source['camera']['projectionMatrix']).reshape((4, 4), order='F')
    clip = (projection @ view @ model @ np.column_stack((p, np.ones(len(p)))).T).T
    ndc = clip[:, :2] / clip[:, 3:4]
    screen = np.column_stack(((ndc[:, 0] + 1) * width / 2, (1 - ndc[:, 1]) * height / 2, np.ones(len(p))))
    uv = np.asarray(portrait['attributes']['uv']['values']).reshape(-1, 2)
    affine = np.linalg.lstsq(screen, uv, rcond=None)[0]
    ys, xs = np.where(portrait_layer[:, :, 3] == 255)
    coords = np.column_stack((xs + .5, ys + .5, np.ones(len(xs)))) @ affine
    if texture_entry['flipY']:
        coords[:, 1] = 1 - coords[:, 1]
    tx = np.clip((coords[:, 0] * original.shape[1]).astype(int), 0, original.shape[1] - 1)
    ty = np.clip((coords[:, 1] * original.shape[0]).astype(int), 0, original.shape[0] - 1)
    # Flat opaque source neighborhoods avoid conflating different mip reconstruction filters.
    selected = []
    for i, (x, y) in enumerate(zip(tx, ty)):
        tile = original[max(0, y - 4):y + 5, max(0, x - 4):x + 5]
        if tile[:, :, 3].min() == 255 and np.max(np.ptp(tile[:, :, :3].astype(int), axis=(0, 1))) <= 6:
            selected.append(i)
    assert len(selected) >= 10, 'Need stable opaque portrait samples'
    actual = portrait_layer[ys[selected], xs[selected], :3].astype(float)
    expected = original[ty[selected], tx[selected], :3].astype(float)
    error = np.abs(actual - expected)
    assert float(np.max(error)) <= 7, 'Portrait color differs from original PNG (possible color-space/UV error)'
    upside_down = original[original.shape[0] - 1 - ty[selected], tx[selected], :3].astype(float)
    assert float(np.mean(error)) < float(np.mean(np.abs(actual - upside_down)))
    # Also sample those pixels in the actual full capture, not just an isolated layer.
    full_error = np.max(np.abs(full[ys[selected], xs[selected], :3].astype(float) - expected), axis=1)
    matching_full = int(np.count_nonzero(full_error <= 7))
    assert matching_full >= 10

    # Isolate a real overflowing draw and compare identical shader with clipping disabled.
    yy, xx = np.mgrid[0:height, 0:width]
    world = np.stack((xx + .5, -(yy + .5), np.zeros_like(xx), np.ones_like(xx)), axis=-1)
    clipping = None
    for draw in source['draws']:
        count = int(draw['uniforms'].get('uClipCount', 0))
        if not count:
            continue
        planes = np.asarray(draw['uniforms']['uClipPlanes'][:count])
        outside = np.any(world @ planes.T < -1e-5, axis=-1)
        uncut = copy.deepcopy(draw)
        uncut['uniforms']['uClipCount'] = 0
        unclipped = layer([uncut])
        would_leak = outside & (unclipped[:, :, 3] > 0)
        if not np.any(would_leak):
            continue
        clipped = layer([draw])
        leaked = int(np.count_nonzero(clipped[:, :, 3][outside]))
        assert leaked == 0
        clipping = {'drawId': draw['id'], 'unclippedOutsidePixels': int(np.count_nonzero(would_leak)),
                    'clippedOutsidePixels': leaked}
        break
    assert clipping, 'Snapshot must include actual clipped overflow, e.g. lobby 320x620'
    report = {'mode': 'offline/sample', 'renderer': ctx.info['GL_RENDERER'],
              'title': title['text'], 'titleAlphaPixels': title_pixels, 'textOpaqueMaxRGBError': text_error,
              'atlasSources': [t['path'] for t in source['textures'] if '/fonts/' in t.get('path', '')],
              'portraitSource': texture_entry['path'], 'portraitSHA256': texture_entry['sha256'],
              'portraitStableSamples': len(selected), 'portraitMaxRGBError': float(np.max(error)),
              'portraitMeanRGBError': float(np.mean(error)), 'portraitUpsideDownMeanRGBError': float(np.mean(np.abs(actual - upside_down))),
              'portraitMatchingFullCapturePixels': matching_full, 'clipping': clipping}
    with args.out.open('x') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    print(json.dumps(report, ensure_ascii=False))
    ctx.release()


if __name__ == '__main__':
    main()
