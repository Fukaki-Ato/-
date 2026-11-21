import * as THREE from 'three';
import {
  Box, Label, Widget, applyClip, clipUniforms, uiColor,
  type BoxOptions, type LayoutBox, type NinePatchSource, type PaintCtx,
} from '@tr/framework/ui/index.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import { coast } from './welfareCards.js';

export { coast } from './welfareCards.js';

export function coastalText(value: string, size = 14, color = coast.ink): Label {
  return new Label({ text: value, fontSizePx: size, color, lineHeightMul: 1.35 });
}

/** Labelled, real actions only. Disabled entries have no click handler. */
export class CoastalAction extends Box {
  readonly label: Label;
  readonly enabled: boolean;
  constructor(host: UiHost, title: string, action?: () => void,
    options: { fill?: string; subtitle?: string; primary?: boolean } = {}) {
    const fill = options.fill ?? coast.paper;
    const enabled = !!action;
    const label = new Label({ text: title, fontSizePx: options.primary ? 20 : 15,
      color: enabled ? coast.ink : coast.muted, lineHeightMul: 1.35, align: options.primary ? 'center' : 'left' });
    super({ background: host.solidSkin, backgroundColor: enabled ? fill : coast.foam,
      minHeight: options.primary ? 58 : 44, minWidth: 44, gap: 3,
      padding: { top: 11, bottom: 11, left: 12, right: 12 },
      align: 'stretch', justify: 'center', onClick: action }, [label]);
    this.label = label;
    this.enabled = enabled;
    if (options.subtitle) this.add(coastalText(enabled ? options.subtitle : '暂不可用', 12, coast.muted));
  }
  override handlers() {
    const handlers = super.handlers();
    if (!handlers) return undefined;
    const fill = this.opts.backgroundColor!;
    return { ...handlers, onPressChange: (pressed: boolean) => {
      this.setBackground({ color: pressed ? coast.gold : fill });
    } };
  }
}

/** A painted bay, never a stand-in person. The shader follows the UI paint/clip contract. */
export class CoastalBay extends Widget {
  private mesh?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  constructor(private readonly height = 210) { super(); }
  protected override onBind(): void {
    const material = new THREE.ShaderMaterial({
      uniforms: { ...clipUniforms(),
        sand: { value: uiColor(coast.sand) }, paper: { value: uiColor(coast.paper) },
        sea: { value: uiColor(coast.sea) }, foam: { value: uiColor(coast.foam) },
        sun: { value: uiColor(coast.gold) }, aspect: { value: 1 },
      }, transparent: true, depthTest: false, depthWrite: false,
      vertexShader: `varying vec2 uv0; varying vec3 point;
        void main(){ uv0=uv; vec4 p=modelMatrix*vec4(position,1.); point=p.xyz;
          gl_Position=projectionMatrix*viewMatrix*p; }`,
      fragmentShader: `varying vec2 uv0; varying vec3 point;
        uniform vec3 sand,paper,sea,foam,sun; uniform float aspect;
        uniform vec4 uClipPlanes[8]; uniform float uClipCount;
        void main(){
          for(int i=0;i<8;i++){ if(float(i)>=uClipCount) break;
            if(dot(vec4(point,1.),uClipPlanes[i])<0.) discard; }
          vec2 p=vec2(uv0.x,1.-uv0.y);
          vec3 c=paper;
          float disc=length((p-vec2(.77,.25))*vec2(aspect,1.));
          c=mix(c,sun,1.-smoothstep(.15,.155,disc));
          float bay=.57+.12*sin(p.x*4.5+.6);
          c=mix(c,foam,smoothstep(bay-.09,bay-.085,p.y));
          c=mix(c,sea,smoothstep(bay+.065,bay+.07,p.y));
          float contour=abs(p.y-bay+.025);
          c=mix(c,sea,.35*(1.-smoothstep(.002,.007,contour)));
          float wave=abs(p.y-(.84+.025*sin(p.x*17.)));
          c=mix(c,foam,.6*(1.-smoothstep(.001,.006,wave)));
          c=mix(c,sand,smoothstep(.96,1.,p.y));
          gl_FragColor=vec4(c,1.);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(.5, -.5, 0), material);
    this.mesh.frustumCulled = false;
    this.requireEnv().stage.add(this.mesh);
  }
  node() { return { id: this.id, height: this.height, passthrough: true }; }
  sync(box: LayoutBox, ctx: PaintCtx): void {
    const mesh = this.mesh!;
    const r = box.rect;
    mesh.position.set(r.x, -r.y, 0); mesh.scale.set(r.w, r.h, 1);
    mesh.material.uniforms['aspect']!.value = r.w / Math.max(1, r.h);
    mesh.renderOrder = ctx.order(); applyClip(mesh.material, ctx);
  }
  protected override onVisible(value: boolean): void { if (this.mesh) this.mesh.visible = value; }
  dispose(): void {
    if (!this.mesh) return;
    this.requireEnv().stage.remove(this.mesh);
    this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh = undefined;
  }
}

/** The supplied source is reused unchanged and kept in its original aspect ratio. */
export function coastalPortrait(source?: NinePatchSource, compact = false): Box {
  const height = compact ? 148 : 198;
  const stage = new Box({ height }, [new CoastalBay(height)]);
  if (source) {
    const h = Math.min(height - 8, 170 * source.texSize.h / source.texSize.w);
    const w = h * source.texSize.w / source.texSize.h;
    stage.add(new Box({ absolute: true, right: 16, bottom: 0, width: w, height: h, background: source }));
  }
  stage.add(new Box({ absolute: true, left: 16, top: 16, width: source ? 90 : 230, gap: 5 }, [
    coastalText('COAST / RUN CLUB', 11, coast.sea),
    coastalText('晴日海湾', source ? 18 : 25),
    ...(!source ? [coastalText('海风正好，准备出发', 13, coast.muted)] : []),
  ]));
  return stage;
}

export function coastalCard(host: UiHost, children: Widget[], options: BoxOptions = {}): Box {
  return new Box({ background: host.solidSkin, backgroundColor: coast.paper, padding: 14, gap: 8, ...options }, children);
}

export function coastalCell(child: Widget): Box { return new Box({ width: 0, flex: 1 }, [child]); }
