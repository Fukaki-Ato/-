"""Original coastal/thunder application-icon candidate. No fonts, photos or old game art.

Pillow renders the same authored geometry written to the editable SVG. Output is
opaque square artwork; platform masking and acceptance are separate review steps.
"""
import argparse
import html
from pathlib import Path
from PIL import Image, ImageDraw


SIZE = 1024
COLORS = {'sea': '#287d86', 'ink': '#153e52', 'foam': '#b7ddd5',
          'sand': '#fff8e6', 'coral': '#f5aa83', 'gold': '#f3d58d'}
LAYERS = [
    ('rect', 'sea-field', COLORS['sea'], [0, 0, 1024, 1024]),
    ('circle', 'warm-sun', COLORS['coral'], [766, 236, 118]),
    ('path', 'bay-swell', COLORS['foam'], [
        ('M', 0, 678), ('C', 228, 598, 316, 661, 487, 717),
        ('C', 697, 789, 865, 668, 1024, 701), ('L', 1024, 1024), ('L', 0, 1024), ('Z',)]),
    ('path', 'deep-water', COLORS['ink'], [
        ('M', 0, 754), ('C', 230, 671, 350, 725, 514, 766),
        ('C', 706, 815, 887, 756, 1024, 755), ('L', 1024, 1024), ('L', 0, 1024), ('Z',)]),
    ('stroke', 'near-lane', COLORS['sand'], 25, [
        ('M', 150, 1050), ('C', 233, 877, 443, 853, 614, 857), ('C', 813, 860, 885, 839, 1034, 814)]),
    ('stroke', 'far-lane', COLORS['foam'], 18, [
        ('M', 444, 1050), ('C', 522, 950, 670, 946, 810, 936), ('C', 909, 930, 968, 917, 1040, 901)]),
    ('path', 'bolt-edge', COLORS['ink'], [
        ('M', 580, 140), ('L', 266, 568), ('L', 455, 568),
        ('L', 359, 831), ('L', 807, 395), ('L', 604, 395), ('L', 722, 140), ('Z',)]),
    ('path', 'thunder-stride', COLORS['gold'], [
        ('M', 562, 119), ('L', 247, 547), ('L', 436, 547),
        ('L', 340, 810), ('L', 788, 374), ('L', 585, 374), ('L', 703, 119), ('Z',)]),
    ('path', 'bolt-light', COLORS['sand'], [
        ('M', 562, 119), ('L', 247, 547), ('L', 436, 547),
        ('L', 465, 495), ('L', 342, 495), ('L', 618, 119), ('Z',)]),
]


def path_points(commands):
    points, current = [], (0, 0)
    for command in commands:
        kind, *v = command
        if kind in ('M', 'L'):
            current = (v[0], v[1]); points.append(current)
        elif kind == 'C':
            x, y = current
            for step in range(1, 49):
                t = step / 48; u = 1-t
                points.append((u**3*x+3*u*u*t*v[0]+3*u*t*t*v[2]+t**3*v[4],
                               u**3*y+3*u*u*t*v[1]+3*u*t*t*v[3]+t**3*v[5]))
            current = (v[4], v[5])
    return points


def draw_icon():
    scale = 4
    canvas = Image.new('RGB', (SIZE*scale, SIZE*scale))
    draw = ImageDraw.Draw(canvas)
    for kind, _, color, *data in LAYERS:
        if kind == 'rect':
            draw.rectangle([v*scale for v in data[0]], fill=color)
        elif kind == 'circle':
            x, y, r = data[0]
            draw.ellipse([(x-r)*scale, (y-r)*scale, (x+r)*scale, (y+r)*scale], fill=color)
        else:
            commands = data[-1]
            points = [(x*scale, y*scale) for x, y in path_points(commands)]
            if kind == 'path':
                draw.polygon(points, fill=color)
            else:
                draw.line(points, fill=color, width=data[0]*scale, joint='curve')
    return canvas.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def editable_svg():
    elements = ['<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">',
                '<title>雷霆酷跑：海湾雷霆图标候选</title>',
                '<desc>Original hand-authored geometry. Candidate only; not submitted or approved. No external fonts or images.</desc>']
    for kind, label, color, *data in LAYERS:
        label = html.escape(label)
        if kind == 'rect':
            x, y, width, height = data[0]
            elements.append(f'<rect id="{label}" x="{x}" y="{y}" width="{width}" height="{height}" fill="{color}"/>')
        elif kind == 'circle':
            x, y, radius = data[0]
            elements.append(f'<circle id="{label}" cx="{x}" cy="{y}" r="{radius}" fill="{color}"/>')
        else:
            d = ' '.join(command[0]+' '+ ' '.join(str(v) for v in command[1:]) for command in data[-1])
            style = f'fill="{color}"' if kind == 'path' else f'fill="none" stroke="{color}" stroke-width="{data[0]}" stroke-linejoin="round"'
            elements.append(f'<path id="{label}" d="{d}" {style}/>')
    return '\n'.join(elements+['</svg>'])+'\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out-dir', required=True, type=Path)
    parser.add_argument('--source', required=True, type=Path)
    args = parser.parse_args()
    outputs = [args.out_dir/f'app-icon-{size}.png' for size in (1024, 512, 144, 64, 32)]
    if args.source.exists() or any(p.exists() for p in outputs):
        parser.error('Output paths already exist; rebuild to a new task-owned directory')
    args.out_dir.mkdir(parents=True, exist_ok=True); args.source.parent.mkdir(parents=True, exist_ok=True)
    with args.source.open('x', encoding='utf8') as handle:
        handle.write(editable_svg())
    icon = draw_icon()
    for path, size in zip(outputs, (1024, 512, 144, 64, 32)):
        image = icon if size == SIZE else icon.resize((size, size), Image.Resampling.LANCZOS)
        with path.open('xb') as handle:
            image.save(handle, format='PNG', compress_level=9)
        print(f'CANDIDATE {path}: {size}x{size} opaque RGB, {path.stat().st_size} bytes')


if __name__ == '__main__':
    main()
