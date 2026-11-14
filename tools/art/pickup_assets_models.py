"""Six distinct first-release equipment silhouettes, authored without input art."""
import math
from mathutils import Matrix
import pickup_assets_geometry as g


def shield():
    g.palette((.025, .47, .92))
    g.sphere('Cobalt solid energy nucleus', (0, 0, 0), (.185, .185, .185), 3, 20, 10)
    # Three physical great circles preserve a sphere, without alpha sorting.
    for name, rot, mat in [('Equatorial cage', (0, 0, 0), 0),
                           ('Meridian cage', (math.pi/2, 0, 0), 2),
                           ('Cross meridian', (0, math.pi/2, 0), 0)]:
        g.ring(name, (0, 0, 0), .292, .021, mat, rot, 28, 5)
    for x, y, z in [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]:
        p = (x*.29, y*.29, z*.29)
        g.sphere('Insulated cage junction', p, (.033, .033, .033), 1, 8, 4)
    g.ring('Core focusing collar', (0, 0, 0), .195, .012, 2, (math.pi/2, 0, 0), 24, 4)
    g.plate('Core lightning inlay', [(-.015,.12),(-.085,-.015),(-.01,-.015),(-.035,-.12),(.085,.035),(.015,.035)], .012, -.184, 0)


def jetpack():
    g.palette((1, .32, .065))
    g.box('Contoured harness backplate', (0, .055, 0), (.33, .12, .49), 1, .04)
    g.box('Ivory spine armour', (0, -.025, .055), (.16, .09, .39), 0, .025)
    for x in [-.21, .21]:
        g.cylinder('Enamel turbine body', (x, 0, -.20), (x, 0, .225), .089, 0, 16)
        g.sphere('Turbine crown', (x, 0, .225), (.088,.088,.07), 0, 12, 6)
        for z in [-.16, .16]:
            g.ring('Turbine metal collar', (x, 0, z), .09, .013, 2, major=16, minor=4)
        g.cylinder('Flared nozzle', (x, 0, -.28), (x, 0, -.195), .103, 2, 16, .073)
        g.cylinder('Nozzle shadow cavity', (x, 0, -.287), (x, 0, -.276), .077, 1, 16)
        g.cylinder('Warm nozzle core', (x, 0, -.293), (x, 0, -.288), .046, 3, 12)
        g.box('Turbine signal stripe', (x, -.088, .015), (.037,.012,.20), 3, .005)
        sign = 1 if x > 0 else -1
        outline = [(sign*.27,.19),(sign*.43,.28),(sign*.38,.05),(sign*.31,.10),(sign*.29,-.065)]
        g.plate('Folded lightning wing', outline, .045, .055, 1)
        g.plate('Wing ivory leading panel', [(sign*.29,.185),(sign*.408,.255),(sign*.367,.12)], .012, .025, 0)
        g.screw((x, -.1, .19))
        g.screw((x, -.1, -.13))
    g.box('Spine signal battery', (0, -.08, .06), (.067,.025,.17), 3, .012)
    g.path('Upper carry handle', [(-.07,.03,.26),(-.07,.03,.32),(.07,.03,.32),(.07,.03,.26)], .017, 2)
    for x in [-.09, .09]:
        g.box('Harness rear cushion', (x, .13, .02), (.085,.055,.32), 1, .025)


def board():
    g.palette((.025, .69, .67))
    # Curved deck with true raised kicks; board long axis X, not a lane-wide 1.5m prop.
    xs = [-.46,-.41,-.31,0,.31,.41,.46]
    zs = [.075,.036,0,-.008,0,.036,.075]
    widths = [.055,.11,.123,.13,.123,.11,.055]
    vertices = []
    for x,z,w in zip(xs,zs,widths):
        vertices += [(x,-w,z),(x,w,z),(x,-w,z-.028),(x,w,z-.028)]
    faces = [(0,2,3,1),(24,25,27,26)]
    for i in range(6):
        a,b=i*4,(i+1)*4
        faces += [(a,a+1,b+1,b),(a+2,b+2,b+3,a+3),(a,b,b+2,a+2),(a+1,a+3,b+3,b+1)]
    g.mesh('Bent maple composite deck', vertices, faces, 0)
    for offset in [-.065,.025]:
        pts = [(x, offset+math.sin(x*7)*.017, z+.004) for x,z in zip(xs,zs)]
        g.path('Raised wave deck inlay', pts, .011, 3, 4)
    for x in [-.29,.29]:
        g.box('Truck mounting plate', (x,0,-.047), (.09,.14,.025), 1, .008)
        g.cylinder('Truck kingpin', (x,0,-.09), (x,0,-.045), .024, 2, 8)
        g.cylinder('Truck axle', (x,-.16,-.10), (x,.16,-.10), .019, 2, 10)
        for y in [-.145,.145]:
            g.cylinder('Soft urethane wheel', (x,y-.025,-.10), (x,y+.025,-.10), .058, 3, 12)
            g.cylinder('Wheel bearing', (x,y-.028,-.10), (x,y+.028,-.10), .023, 2, 10)
        for y in [-.06,.06]:
            g.cylinder('Deck fastener', (x,y,.005), (x,y,.013), .009, 2, 6)
    g.plate('Club lightning tail mark', [(-.035,.04),(-.005,-.025),(.01,.005),(.035,-.04),(.005,.025),(-.01,-.005)], .005, -.003, 1)
    # Turn the entire board into a diagonal display pose: top graphic and wheels both visible.
    transform = Matrix.Rotation(-.57,4,'Y') @ Matrix.Rotation(math.radians(66),4,'X')
    for o in g.PARTS:
        o.matrix_world = transform @ o.matrix_world


def multiplier():
    g.palette((1, .65, .035))
    g.box('Twin-cell navy cradle', (0,.045,0), (.62,.20,.45), 1, .045)
    for x in [-.17,.17]:
        g.cylinder('Coin energy cell', (x,.035,-.235),(x,.035,.235), .112, 0, 16)
        for z in [-.23,.23]:
            g.cylinder('Gold cell end-cap', (x,.035,z-.016),(x,.035,z+.016), .115, 3, 16)
        g.box('Charge indicator', (x,.15,.03), (.035,.012,.19), 3,.005)
    g.box('Raised x2 badge silver rim', (0,-.103,0), (.57,.045,.34), 2,.035)
    g.box('Badge navy recess', (0,-.13,0), (.53,.018,.30), 1,.02)
    # Hand-authored polygon glyphs, no font/texture dependency. Full mirrored-back badge too.
    for back in [False,True]:
        y = .178 if back else -.148
        start = len(g.PARTS)
        g.box('Multiplication rising stroke', (-.145,y,0), (.057,.023,.19), 3,.007, (0,-.65,0))
        g.box('Multiplication falling stroke', (-.145,y,0), (.057,.023,.19), 3,.007, (0,.65,0))
        g.path('Geometric numeral TWO',[(0,y,.045),(.015,y,.09),(.125,y,.09),(.16,y,.06),(.16,y,.025),(.005,y,-.08),(.005,y,-.105),(.18,y,-.105)],.025,3,6)
        if back:
            for o in g.PARTS[start:]:
                o.scale.x *= -1
                o.location.x *= -1
    for x in [-.25,.25]:
        g.screw((x,-.151,.115))
        g.screw((x,-.151,-.115))
    g.path('Bail carrying handle', [(-.095,.035,.25),(-.095,.035,.32),(.095,.035,.32),(.095,.035,.25)], .018, 2)


def boots():
    g.palette((.18, .78, .40))
    for x in [-.175,.175]:
        # A sequence of cross-sections gives a toe, vamp, ankle and heel, not two boxes.
        sections = [(-.26,.035,.105,.025),(-.225,.095,.115,.055),(-.16,.115,.12,.07),(-.04,.115,.145,.095),(.065,.105,.19,.14),(.16,.095,.19,.14)]
        verts=[]
        for y,w,z,h in sections:
            for j in range(10):
                t=j*math.tau/10
                verts.append((x+w*math.cos(t),y,z+h*math.sin(t)))
        faces=[tuple(range(9,-1,-1)),tuple(range(50,60))]
        for i in range(5):
            for j in range(10):
                a=i*10+j;b=i*10+(j+1)%10
                faces.append((a,b,b+10,a+10))
        g.mesh('Sculpted athletic upper',verts,faces,0,True)
        g.sphere('Dark padded ankle opening', (x,.077,.335), (.079,.085,.026), 1, 12, 6)
        g.ring('Ankle cuff piping', (x,.077,.327), .075,.013,3,major=12,minor=4)
        g.box('Heel pull tab',(x,.16,.29),(.043,.03,.11),1,.008)
        outline=[(-.09,-.25),(.09,-.25),(.125,-.17),(.125,.10),(.09,.18),(-.09,.18),(-.125,.10),(-.125,-.17)]
        sole=[(x+u,v,z) for z in [-.01,.047] for u,v in outline]
        g.mesh('Foot-shaped layered outsole',sole,[tuple(range(7,-1,-1)),tuple(range(8,16))]+[(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)],1)
        g.box('Floating spring footplate',(x,-.035,-.128),(.245,.43,.042),2,.02)
        for y in [-.15,.10]:
            # Two visible bowed leaf-spring assemblies under each shoe.
            g.path('Energy return leaf',[(x-.095,y,-.005),(x-.06,y,-.055),(x,y,-.09),(x+.06,y,-.055),(x+.095,y,-.005)],.016,3,6)
        for y in [-.18,-.06,.06]:
            g.box('Rubber tread pad',(x,y,-.157),(.20,.065,.025),1,.008)
        for y,z in [(-.13,.206),(-.075,.232),(-.02,.270),(.032,.309)]:
            g.path('Contrasting lace',[(x-.06,y,z-.008),(x,y-.006,z+.008),(x+.06,y,z-.008)],.009,1,5)
        g.path('Toe bumper seam',[(x-.09,-.213,.145),(x-.06,-.242,.15),(x,-.258,.15),(x+.06,-.242,.15),(x+.09,-.213,.145)],.009,3,5)
        for side in [-1,1]:
            g.path('Stitched side seam',[(x+side*.095,-.17,.12),(x+side*.113,-.05,.15),(x+side*.10,.10,.22)],.006,2,4)
        g.plate('Outer ankle signal patch', [(x-.045,.19),(x+.045,.19),(x+.03,.24),(x-.03,.24)], .012,-.002,3)


def helmet():
    g.palette((1, .40, .22))
    # Open-bottom double wall dome: inner liner is actual topology, not a solid ball.
    segments=24;rings=8
    for inner in [False,True]:
        verts=[]
        scale=.925 if inner else 1
        for i in range(rings+1):
            theta=.055+(math.pi/2-.055)*i/rings
            for j in range(segments):
                a=j*math.tau/segments
                verts.append((.31*scale*math.sin(theta)*math.cos(a),.27*scale*math.sin(theta)*math.sin(a),.30*scale*math.cos(theta)))
        faces=[]
        for i in range(rings):
            for j in range(segments):
                a=i*segments+j;b=i*segments+(j+1)%segments
                face=(a,b,b+segments,a+segments)
                faces.append(tuple(reversed(face)) if inner else face)
        faces.append(tuple(range(segments-1,-1,-1)))
        g.mesh('EPS padded liner' if inner else 'Rounded club helmet shell',verts,faces,1 if inner else 0,True)
    # Elliptical rolled rim and projecting short peak.
    r=g.ring('Protective rolled rim',(0,0,0),.292,.018,1,major=28,minor=5)
    r.scale.y=.88
    g.box('Short sun peak',(0,-.255,.012),(.47,.19,.035),1,.035)
    g.box('Peak coral lip',(0,-.325,.016),(.36,.032,.025),3,.012)
    # Raised dark vent grilles follow the curved shell, without alpha/decal tricks.
    for x in [-.145,0,.145]:
        for y in [-.105,.075]:
            verts=[]
            for offset in [-.003,.003]:
                for v in [-.045,-.015,.015,.045]:
                    for u in [-.015,.015]:
                        xx,yy=x+u,y+v
                        z=.30*math.sqrt(1-(xx/.31)**2-(yy/.27)**2)
                        verts.append((xx,yy,z+offset))
            faces=[]
            for row in range(3):
                a=row*2
                faces.extend([(a,a+2,a+3,a+1),(a+8,a+9,a+11,a+10)])
            faces += [(0,1,9,8),(6,14,15,7),(0,8,14,6),(1,7,15,9)]
            g.mesh('Shell-following dark ventilation slot',verts,faces,1,True)
    for sign in [-1,1]:
        g.cylinder('Side buckle mounting rivet',(sign*.294,-.014,.035),(sign*.316,-.014,.035),.034,2,12)
        g.path('Woven Y strap',[(sign*.28,-.06,.005),(sign*.245,-.025,-.135),(sign*.27,.12,-.005)],.015,1,6)
        g.box('Coral quick release clasp',(sign*.24,-.028,-.13),(.056,.045,.063),3,.009)
    g.path('Adjustable chin bridge',[(-.245,-.025,-.135),(-.12,-.055,-.191),(.12,-.055,-.191),(.245,-.025,-.135)],.014,1)
    g.plate('Club shell forehead badge',[(-.045,.10),(.045,.10),(.035,.16),(-.035,.16)],.018,-.265,3)


BUILDERS = dict(shield=shield, jetpack=jetpack, board=board, multiplier=multiplier, boots=boots, helmet=helmet)
