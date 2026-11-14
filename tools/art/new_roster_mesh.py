"""Original coastal-club mesh drafting helpers. No imported meshes/textures."""
import math
from mathutils import Vector, Quaternion

TAU = math.tau


class Draft:
    def __init__(self):
        self.verts, self.faces, self.mats, self.weights = [], [], [], []

    def vertex(self, p, weights):
        self.verts.append(tuple(p))
        self.weights.append({weights: 1.0} if isinstance(weights, str) else weights)
        return len(self.verts) - 1

    def face(self, indices, mat):
        self.faces.append(indices)
        self.mats.append(mat)

    def loft(self, rings, mat, weights, sides=16, caps=True):
        """Horizontal elliptical cross sections: x/y/z/rx/ry, with optional seam angle."""
        loops = []
        for i, (x, y, z, rx, ry) in enumerate(rings):
            w = weights(z) if callable(weights) else weights
            loops.append([self.vertex((x + rx * math.cos(TAU*j/sides),
                                       y + ry * math.sin(TAU*j/sides), z), w)
                          for j in range(sides)])
        for a, b in zip(loops, loops[1:]):
            for j in range(sides):
                self.face((a[j], a[(j+1) % sides], b[(j+1) % sides], b[j]), mat)
        if caps:
            self.face(tuple(reversed(loops[0])), mat)
            self.face(tuple(loops[-1]), mat)

    def ellipsoid(self, center, scale, mat, weights, sides=16, rings=10, rotation=None):
        # Deliberate low-poly patches for eyes, ears, clasps and sculpted hair sections.
        rot = rotation or Quaternion()
        loops = []
        for i in range(rings + 1):
            lat = -math.pi/2 + math.pi * i/rings
            loops.append([self.vertex(Vector(center) + rot @ Vector((
                scale[0] * math.cos(lat) * math.cos(TAU*j/sides),
                scale[1] * math.cos(lat) * math.sin(TAU*j/sides),
                scale[2] * math.sin(lat))), weights) for j in range(sides)])
        for a, b in zip(loops, loops[1:]):
            for j in range(sides):
                self.face((a[j], a[(j+1) % sides], b[(j+1) % sides], b[j]), mat)

    def tube(self, path, radii, mat, weights, sides=8, flatten=1.0):
        loops = []
        for i, p in enumerate(path):
            tangent = Vector(path[min(i+1, len(path)-1)]) - Vector(path[max(i-1, 0)])
            tangent.normalize()
            u = tangent.cross(Vector((0, 1, 0)))
            if u.length < .01:
                u = tangent.cross(Vector((1, 0, 0)))
            u.normalize()
            v = tangent.cross(u).normalized()
            radius = radii[i] if isinstance(radii, (tuple, list)) else radii
            w = weights(i) if callable(weights) else weights
            loops.append([self.vertex(Vector(p) + radius * (
                u*math.cos(TAU*j/sides) + v*flatten*math.sin(TAU*j/sides)), w)
                          for j in range(sides)])
        for a, b in zip(loops, loops[1:]):
            for j in range(sides):
                self.face((a[j], a[(j+1) % sides], b[(j+1) % sides], b[j]), mat)
        self.face(tuple(reversed(loops[0])), mat)
        self.face(tuple(loops[-1]), mat)

    def ribbon(self, centers, widths, mat, weights, thickness=.008):
        # Tailored thick ribbon, variable silhouette, visible from either side.
        loops = []
        for p, width in zip(centers, widths):
            x, y, z = p
            loops.append([self.vertex((x+dx*width/2, y+dy*thickness/2, z), weights)
                          for dx, dy in [(-1,-1),(1,-1),(1,1),(-1,1)]])
        for a, b in zip(loops, loops[1:]):
            for j in range(4):
                self.face((a[j], a[(j+1)%4], b[(j+1)%4], b[j]), mat)
        self.face(tuple(reversed(loops[0])), mat)
        self.face(tuple(loops[-1]), mat)

    def ring(self, center, radius, thickness, mat, weights, axis='Y', arc=TAU):
        path = []
        for i in range(25):
            a = arc*i/24
            dx, dy = radius*math.cos(a), radius*math.sin(a)
            offset = (dx, 0, dy) if axis == 'Y' else (dx, dy, 0)
            path.append(tuple(center[j]+offset[j] for j in range(3)))
        self.tube(path, thickness, mat, weights, 6)


def blend(z, lower, upper, joint, span=.07):
    t = max(0, min(1, (z-joint)/span + .5))
    return {lower: 1-t, upper: t}


def build_body(d, spec):
    skin, shade, hair, ink, cream, main, trim, white, iris, glow = range(10)
    def torso(z):
        if z < .94:
            return blend(z, 'Hips', 'Spine', .91, .12)
        return blend(z, 'Spine', 'Chest', 1.08, .18)
    # One continuous tailored trunk, cinched waist, shoulder yoke and rounded neckline.
    d.loft([(0,0,.79,.14,.095),(0,0,.84,.163,.105),(0,0,.91,.14,.095),
            (0,0,.99,.134,.09),(0,-.005,1.08,.166,.105),
            (0,0,1.18,.197,.108),(0,0,1.25,.191,.083),
            (0,0,1.29,.135,.068),(0,0,1.305,.067,.057)],
           main, torso, 24)
    d.loft([(0,0,1.26,.058,.048),(0,0,1.31,.054,.048),
            (0,0,1.37,.057,.05)], skin, lambda z: blend(z,'Chest','Neck',1.32), 16)
    # Rounded, tapered jaw/cheek/forehead profile; front is Blender -Y / glTF +Z.
    d.loft([(0,-.018,1.335,.045,.047),(0,-.024,1.35,.074,.067),
            (0,-.018,1.385,.105,.088),(0,-.008,1.425,.128,.107),
            (0,0,1.47,.134,.114),(0,.007,1.52,.132,.115),
            (0,.012,1.57,.122,.106),(0,.014,1.61,.094,.083),
            (0,.014,1.633,.048,.043),(0,.014,1.639,.009,.008)],
           skin, 'Head', 24)
    for s in [-1, 1]:
        d.ellipsoid((s*.131,.002,1.455),(.024,.022,.039),skin,'Head',12,6)
        d.ellipsoid((s*.141,-.014,1.456),(.012,.006,.022),shade,'Head',10,5)
        # Soft almond eyes, outlined upper lids, iris/pupil/highlight layers.
        x = s*.055
        d.ellipsoid((x,-.106,1.474),(.044,.013,.029),ink,'Head',16,7)
        d.ellipsoid((x,-.116,1.472),(.039,.010,.024),white,'Head',16,7)
        d.ellipsoid((x+s*.001,-.125,1.472),(.017,.006,.020),iris,'Head',12,7)
        d.ellipsoid((x+s*.001,-.130,1.472),(.009,.003,.014),ink,'Head',12,6)
        d.ellipsoid((x-.006,-.133,1.480),(.005,.002,.006),white,'Head',8,4)
        d.tube([(x-s*.04,-.109,1.515),(x,-.124,1.523),
                (x+s*.037,-.108,1.515)], [.004,.007,.003],hair,'Head',6)
    # Small shaped bridge and soft nose tip, smile/lower lip.
    d.loft([(0,-.11,1.429,.016,.01),(0,-.137,1.439,.020,.017),
            (0,-.124,1.46,.012,.014),(0,-.109,1.485,.008,.008)],skin,'Head',12)
    d.tube([(-.031,-.102,1.396),(-.015,-.113,1.391),(0,-.116,1.390),
            (.018,-.112,1.394),(.030,-.103,1.401)], [.002,.003,.003,.003,.002],
           shade,'Head',6)
    d.tube([(-.014,-.111,1.383),(0,-.114,1.382),(.015,-.110,1.385)],
           .002,skin,'Head',5)
    # Arms: connected seven-section loft, blended elbow and wrist skin weights.
    for s, side in [(-1,'R'),(1,'L')]:
        upper, lower, hand = 'ArmUpper'+side, 'ArmLower'+side, 'Hand'+side
        def aw(z, up=upper, lo=lower, ha=hand):
            return blend(z,ha,lo,.848,.065) if z < .91 else blend(z,lo,up,1.055,.10)
        d.loft([(s*.349,0,.815,.034,.033),(s*.344,0,.86,.038,.037),
                (s*.332,0,.93,.043,.041),(s*.315,0,1.025,.043,.043),
                (s*.302,0,1.07,.047,.046),(s*.275,0,1.15,.057,.052),
                (s*.238,0,1.235,.065,.060),(s*.187,0,1.249,.057,.052)],
               main if spec in ('rina','bolt') else skin,aw,16)
        # Relaxed mitten hands with modeled thumb, not spheres at stick ends.
        d.loft([(s*.355,-.008,.757,.024,.025),(s*.356,-.009,.773,.036,.030),
                (s*.353,-.004,.813,.038,.033),(s*.348,0,.842,.031,.029)],
               skin,hand,12)
        d.tube([(s*.329,-.007,.81),(s*.319,-.025,.79),(s*.322,-.03,.774)],
               [.015,.015,.010],skin,hand,8)
        # Cuffed sleeves, angular seams and wrist trim.
        d.loft([(s*.289,0,1.105,.057,.054),(s*.27,0,1.168,.066,.061),
                (s*.237,0,1.228,.070,.065),(s*.19,0,1.246,.061,.055)],
               main,aw,16)
        d.loft([(s*.288,0,1.102,.058,.055),(s*.285,0,1.12,.060,.057)],
               cream,aw,16)
        d.loft([(s*.344,0,.847,.042,.04),(s*.338,0,.88,.043,.041)],ink,lower,12)
        d.loft([(s*.342,0,.857,.043,.041),(s*.340,0,.868,.044,.042)],trim,lower,12)
        if spec in ('rina','bolt'):
            d.loft([(s*.343,0,.873,.044,.042),(s*.336,0,.914,.049,.046),
                    (s*.328,0,.97,.052,.049),(s*.315,0,1.027,.048,.047),
                    (s*.298,0,1.086,.053,.051),(s*.280,0,1.14,.062,.057)],
                   main,aw,16)
            # Woven cuff and elbow seam distinguish bomber/coat from bare-arm outfits.
            d.loft([(s*.345,0,.844,.045,.043),(s*.340,0,.88,.047,.045)],
                   cream if spec=='rina' else ink,lower,12)
            d.tube([(s*.363,-.027,.91),(s*.348,-.037,.98),(s*.335,-.036,1.035)],
                   .0035,trim,lower,5)
        # Continuous fitted tapered trouser leg with smooth knee weight transition.
        thigh, shin, foot = 'LegUpper'+side, 'LegLower'+side, 'Foot'+side
        def lw(z, th=thigh, sh=shin, ft=foot):
            if z < .20:
                return blend(z,ft,sh,.16,.075)
            if z > .77:
                return blend(z,th,'Hips',.84,.09)
            return blend(z,sh,th,.46,.13)
        d.loft([(s*.105,0,.14,.044,.046),(s*.105,0,.22,.048,.049),
                (s*.105,.006,.32,.060,.058),(s*.105,0,.425,.061,.062),
                (s*.105,-.009,.48,.060,.062),(s*.105,0,.57,.071,.073),
                (s*.102,0,.69,.086,.084),(s*.092,0,.79,.090,.086),
                (s*.082,0,.845,.08,.078)],ink,lw,18)
        # Kneepad & slim outer seam articulate with leg; no disconnected ball joint.
        d.ellipsoid((s*.105,-.059,.469),(.044,.016,.056),main,
                    {thigh:.52,shin:.48},12,7)
        d.tube([(s*.177,0,.74),(s*.177,-.008,.65),(s*.166,-.012,.57)],
               .006,main,thigh,6)
        # Shoe upper and distinct welt/sole, toes face -Y.
        d.loft([(s*.105,-.045,.025,.064,.122),(s*.105,-.045,.052,.069,.126),
                (s*.105,-.043,.085,.068,.119),(s*.105,-.03,.117,.058,.097),
                (s*.105,0,.157,.049,.056),(s*.105,0,.19,.047,.049)],main,foot,18)
        d.loft([(s*.105,-.045,.002,.063,.119),(s*.105,-.045,.012,.069,.126),
                (s*.105,-.045,.036,.071,.127),(s*.105,-.045,.045,.068,.124)],
               cream,foot,18)
        d.loft([(s*.105,-.045,.003,.064,.119),(s*.105,-.045,.012,.070,.125)],
               ink,foot,18)
        for z, y in [(.11,-.091),(.12,-.072),(.13,-.049)]:
            d.tube([(s*.105-.032,y,z),(s*.105+.032,y,z)],.004,cream,foot,6)
    # Waistband and continuous vertical jacket zipper.
    d.loft([(0,0,.872,.156,.108),(0,0,.894,.153,.107)],trim,'Hips',24)
    d.tube([(0,-.099,.91),(0,-.098,1.0),(0,-.112,1.1),(0,-.103,1.22),
            (0,-.076,1.28)],.004,trim,torso(1.12),6)
    # Curved neckline piping.
    path = [(.067*math.cos(TAU*i/24),.059*math.sin(TAU*i/24),1.304) for i in range(25)]
    d.tube(path,.009,cream,'Chest',6)
    # Club insignia: layered diamond on left chest, fine seam details.
    d.ellipsoid((.105,-.105,1.174),(.028,.009,.033),cream,'Chest',8,5)
    d.tube([(.091,-.116,1.177),(.104,-.12,1.191),(.118,-.116,1.177),
            (.104,-.12,1.162),(.091,-.116,1.177)],.004,trim,'Chest',5)


def scalp(d, hair, kind):
    # Sculpted cap stops at temples/front; rear drops into a tailored hairline.
    loops=[]
    for k in range(8):
        t=k/7
        loop=[]
        for j in range(32):
            a=TAU*j/32
            front=max(0,-math.sin(a))
            bottom=1.44 if kind in ('ama','rina') else 1.49
            z0=bottom+(1.545-bottom)*front**3
            z=z0+(1.66-z0)*math.sin(t*math.pi/2)
            radius=math.cos(t*math.pi/2)
            loop.append(d.vertex((.144*radius*math.cos(a),
                                   .012+.126*radius*math.sin(a),z),'Head'))
        loops.append(loop)
    for a,b in zip(loops,loops[1:]):
        for j in range(32):
            d.face((a[j],a[(j+1)%32],b[(j+1)%32],b[j]),hair)


def build_style(d, key):
    skin, shade, hair, ink, cream, main, trim, white, iris, glow = range(10)
    scalp(d,hair,key)
    if key == 'ama':
        # Asymmetric coiled bob: large interlocking sculpted locks + gold cuffs.
        for i in range(11):
            a=TAU*i/11
            front=-math.sin(a)
            z=1.536 if front>.5 else 1.48
            d.tube([(.09*math.cos(a),.01+.08*math.sin(a),1.61),
                    (.144*math.cos(a),.012+.122*math.sin(a),1.54),
                    (.147*math.cos(a),.012+.125*math.sin(a),z),
                    (.126*math.cos(a),.015+.113*math.sin(a),z-.022)],
                   [.035,.043,.035,.013],hair,'Head',10)
        for s in [-1,1]:
            d.ring((s*.137,-.024,1.414),.024,.006,trim,'Head')
        # Cream short overshirt side panels, mint inner vest.
        for s in [-1,1]:
            d.ribbon([(s*.11,-.096,.92),(s*.119,-.104,1.05),
                      (s*.14,-.092,1.20),(s*.09,-.077,1.27)],
                     [.052,.055,.063,.041],cream,'Chest')
        # Cross-body woven strap with a real hip satchel and magnet ring clasp.
        d.tube([(-.16,-.071,1.24),(-.08,-.125,1.12),(.02,-.123,1.01),
                (.15,-.098,.90)],.014,ink,'Chest',8, .48)
        d.loft([(.173,-.022,.775,.066,.046),(.177,-.027,.805,.076,.052),
                (.176,-.027,.886,.073,.050),(.173,-.023,.902,.066,.046)],
               trim,'Hips',16)
        d.loft([(.175,-.033,.852,.078,.052),(.175,-.033,.895,.078,.052)],main,'Hips',16)
        d.ring((.176,-.090,.855),.033,.009,trim,'Hips')
        d.ring((-.184,-.008,.96),.065,.014,trim,'Spine',arc=math.pi*1.7)
        for x in [-.242,-.136]:
            d.ellipsoid((x,-.009,.921),(.017,.017,.022),glow,'Spine',10,5)
    elif key == 'kaze':
        # Wind-cut swept quiff, shaved-side ribbing, one long lock.
        for i in range(5):
            x=-.10+i*.042
            d.tube([(x,.07,1.56),(x*.85,.015,1.634),(x+.025,-.08,1.638),
                    (x+.06,-.118,1.58)], [.025,.038,.035,.006],hair,'Head',10)
        for s in [-1,1]:
            d.tube([(s*.139,.045,1.50),(s*.139,.015,1.53),(s*.132,-.02,1.55)],
                   .008,main,'Head',6)
        # Sleeveless aerodynamic vest layered over shoulder sleeve/yoke.
        for s in [-1,1]:
            d.ribbon([(s*.09,-.102,.93),(s*.12,-.119,1.07),
                      (s*.145,-.100,1.23),(s*.10,-.07,1.29)],
                     [.06,.069,.06,.035],cream,'Chest')
            # Arm bracers and skates: long low glide runner with visible mounting ribs.
            side='L' if s>0 else 'R'
            d.loft([(s*.33,0,.91,.049,.045),(s*.324,0,.96,.052,.049),
                    (s*.32,0,.985,.043,.043)],ink,'ArmLower'+side,12)
            d.ribbon([(s*.105,-.056,.006),(s*.105,-.056,-.012)],
                     [.056,.047],trim,'Foot'+side,.19)
            for y in [-.13,-.025,.052]:
                d.ellipsoid((s*.105,y,.015),(.022,.012,.019),glow,'Foot'+side,10,5)
        # Split sea-silk scarf tails with continuous tapered silhouette.
        for s in [-1,1]:
            d.ribbon([(s*.04,.069,1.285),(s*.095,.15,1.24),
                      (s*.15,.20,1.14),(s*.20,.23,1.04)],
                     [.065,.064,.052,.009],main,'Scarf'+('L' if s>0 else 'R'))
        d.loft([(0,0,1.27,.076,.071),(0,0,1.31,.071,.067)],main,'Neck',20)
        d.tube([(-.065,-.04,1.282),(-.03,-.083,1.271),(.036,-.084,1.278),
                (.073,-.032,1.292)],.014,main,'Neck',8)
    elif key == 'rina':
        # Copper bob, sliced side part and swept fringe, no shared hair silhouette.
        for s in [-1,1]:
            d.tube([(s*.10,.05,1.60),(s*.144,0,1.53),(s*.142,-.002,1.42),
                    (s*.105,-.024,1.375)], [.041,.045,.040,.009],hair,'Head',10)
        for i in range(4):
            d.tube([(-.08+i*.042,-.04,1.64),(-.035+i*.043,-.105,1.60),
                    (.025+i*.029,-.12,1.54)], [.027,.035,.008],hair,'Head',10)
        # Aviator goggles worn above forehead, framed lenses and bridge.
        for s in [-1,1]:
            d.ellipsoid((s*.061,-.107,1.585),(.047,.019,.030),trim,'Head',14,7)
            d.ellipsoid((s*.061,-.125,1.585),(.036,.006,.021),iris,'Head',14,7)
            d.tube([(s*.074,-.133,1.593),(s*.051,-.134,1.577)],.003,white,'Head',5)
        d.tube([(-.019,-.12,1.584),(0,-.128,1.592),(.019,-.12,1.584)],.006,ink,'Head',6)
        # Cream shearling lapels and bomber-jacket hem.
        for s in [-1,1]:
            d.ribbon([(s*.045,-.11,1.1),(s*.105,-.115,1.2),(s*.075,-.087,1.29)],
                     [.032,.062,.045],cream,'Chest',.016)
        d.loft([(0,0,.91,.148,.105),(0,0,.954,.147,.104)],ink,'Spine',24)
        # Folded glider backpack, two layered swept feather-like hard panels each side.
        d.loft([(0,.112,1.02,.073,.044),(0,.135,1.09,.09,.055),
                (0,.127,1.22,.078,.05),(0,.106,1.25,.06,.033)],ink,'Chest',16)
        for s in [-1,1]:
            b='Wing'+('L' if s>0 else 'R')
            d.ribbon([(s*.095,.144,1.22),(s*.20,.16,1.13),
                      (s*.237,.171,.99),(s*.17,.18,.91)],
                     [.07,.11,.10,.015],cream,b,.023)
            d.ribbon([(s*.086,.171,1.18),(s*.149,.185,1.08),
                      (s*.18,.198,.96)], [.045,.073,.012],main,b,.015)
            d.tube([(s*.102,.177,1.21),(s*.205,.19,1.12),(s*.211,.19,1.01)],
                   .006,trim,b,6)
            d.ellipsoid((s*.09,.194,1.20),(.026,.014,.026),trim,b,12,6)
    else:
        # Ink/violet asymmetric wedge cut, pale silver forelock.
        for i in range(5):
            x=-.095+i*.043
            d.tube([(x,.055,1.58),(x+.018,-.016,1.619),
                    (x-.040,-.103,1.575),(x-.075,-.12,1.50+i*.018)],
                   [.025,.032,.031,.003],cream if i==3 else hair,'Head',9)
        # Split short-long coat: two articulated front skirt panels + longer back panels.
        for s in [-1,1]:
            bone='Coat'+('L' if s>0 else 'R')
            d.ribbon([(s*.106,-.080,.92),(s*.14,-.09,.80),
                      (s*.171,-.04,.66),(s*.18,0,.62)],
                     [.10,.117,.105,.06],main,bone,.018)
            d.ribbon([(s*.095,.075,.95),(s*.13,.106,.79),
                      (s*.163,.14,.60),(s*.16,.13,.56)],
                     [.13,.15,.14,.075],ink,bone,.018)
            d.tube([(s*.158,-.09,.86),(s*.188,-.05,.70),(s*.197,0,.63)],
                   .005,trim,bone,6)
            d.ribbon([(s*.05,-.11,1.05),(s*.11,-.115,1.19),(s*.076,-.075,1.29)],
                     [.032,.047,.045],cream,'Chest',.013)
            side='L' if s>0 else 'R'
            # Time-ring gloves, concentric mechanical bezel, four hour markers.
            d.loft([(s*.354,0,.766,.036,.033),(s*.354,0,.813,.041,.037),
                    (s*.346,0,.844,.037,.034)],ink,'Hand'+side,12)
            d.ring((s*.354,-.041,.810),.033,.007,trim,'Hand'+side)
            d.ring((s*.354,-.045,.810),.022,.003,glow,'Hand'+side)
            d.tube([(s*.354,-.049,.81),(s*.354-.012,-.049,.824)],.003,white,'Hand'+side,5)
        d.ellipsoid((0,-.112,1.16),(.024,.008,.032),trim,'Chest',12,6)
        d.ring((0,-.121,1.16),.018,.003,glow,'Chest')
