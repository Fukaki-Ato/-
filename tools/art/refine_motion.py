"""Author a contact/recovery run cycle and a seamless relaxed idle on an imported rig.

All targets are measured from its existing bind skeleton. No collider or model scale
is changed. Keys are baked to the original named joints, not a runtime deformation.
"""
import bpy
import math
from mathutils import Matrix, Vector


def rotation(axis, angle):
    return Matrix.Rotation(angle, 4, axis)


def author_motion(rig, forward=1, compact_stride=False):
    scene = bpy.context.scene
    source_fps = scene.render.fps
    scene.render.fps = 30
    # Imported clips use 24 fps; newly authored source uses 30. Preserve seconds in both.
    for action in bpy.data.actions:
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        for key in curve.keyframe_points:
                            key.co.x *= 30 / source_fps
                            key.handle_left.x *= 30 / source_fps
                            key.handle_right.x *= 30 / source_fps
    ad = rig.animation_data_create()
    ad.action = None
    for track in list(ad.nla_tracks):
        ad.nla_tracks.remove(track)
    rest = {b.name: b.matrix_local.copy() for b in rig.data.bones}
    heads = {b.name: b.head_local.copy() for b in rig.data.bones}
    feet = {}
    for side in ('L', 'R'):
        name = 'Foot' + side
        candidates = []
        for obj in scene.objects:
            if obj.type != 'MESH' or name not in obj.vertex_groups:
                continue
            index = obj.vertex_groups[name].index
            candidates += [(obj.matrix_world @ v.co).z for v in obj.data.vertices
                           if any(g.group == index and g.weight > .5 for g in v.groups)]
        feet[side] = heads[name].z - min(candidates)
    leg_length = sum((heads[a] - heads[b]).length for a, b in
                     [('LegUpperL', 'LegLowerL'), ('LegLowerL', 'FootL')])
    hip_drop = feet['L'] + .008 + leg_length * (.90 if compact_stride else .83) - heads['LegUpperL'].z

    def set_matrix(name, matrix):
        rig.pose.bones[name].matrix = matrix
        bpy.context.view_layer.update()

    def aim(name, head, end, rest_end):
        q = (rest_end - heads[name]).rotation_difference(end - head)
        set_matrix(name, Matrix.Translation(head) @ q.to_matrix().to_4x4() @ rest[name].to_quaternion().to_matrix().to_4x4())

    def pose(t, running):
        theta = t * math.tau
        for bone in rig.pose.bones:
            bone.matrix_basis.identity()
        offset = hip_drop + leg_length * .025 * (1 - math.cos(theta * 2)) if running else .006 * math.sin(theta)
        set_matrix('Root', Matrix.Translation((0, 0, offset)) @ rest['Root'])
        # Torso counter-rotation and a small forward lean, with the head held steady.
        for name, lean, twist in [('Hips', 0, .035), ('Spine', -.035, .025), ('Chest', -.065, -.07), ('Neck', .03, 0), ('Head', .055, 0)]:
            bone = rig.pose.bones[name]
            parent = bone.parent
            base = parent.matrix @ rest[parent.name].inverted() @ rest[name]
            pos = base.translation.copy()
            orient = rotation('Z', (twist * math.sin(theta) if running else .012 * math.sin(theta)))
            orient @= rotation('X', forward * (lean if running else .008 * math.sin(theta)))
            base.translation = Vector((0, 0, 0))
            set_matrix(name, Matrix.Translation(pos) @ orient @ base)
        for side in ('L', 'R'):
            p = theta + (0 if side == 'L' else math.pi)
            upper, lower, foot = (name + side for name in ('LegUpper', 'LegLower', 'Foot'))
            hip = rig.pose.bones['Hips'].matrix @ rest['Hips'].inverted() @ heads[upper]
            if running:
                target = Vector((heads[foot].x, forward * leg_length * (.34 if compact_stride else .46) * math.cos(p),
                                 feet[side] + .008 + leg_length * (.28 if compact_stride else .48) * max(0, -math.sin(p)) ** 2))
            else:
                target = Vector((heads[foot].x, heads[foot].y, feet[side]))
            a, b = (heads[lower] - heads[upper]).length, (heads[foot] - heads[lower]).length
            delta = target - hip
            distance = min(delta.length, (a + b) * .998)
            axis = delta.normalized()
            target = hip + axis * distance
            along = (a*a - b*b + distance*distance) / (2*distance)
            pole = Vector((0, forward, 0))
            bend = (pole - axis * pole.dot(axis)).normalized()
            knee = hip + axis * along + bend * math.sqrt(max(0, a*a - along*along))
            aim(upper, hip, knee, heads[lower])
            aim(lower, knee, target, heads[foot])
            # Flat support sole, toe lift during recovery; no foot twisting amplification.
            flex = .23 * max(0, -math.sin(p)) if running else 0
            set_matrix(foot, Matrix.Translation(target) @ rotation('X', -forward*flex) @ rest[foot].to_quaternion().to_matrix().to_4x4())
            arm, elbow, hand = (name + side for name in ('ArmUpper', 'ArmLower', 'Hand'))
            parent = rig.pose.bones[arm].parent
            shoulder = parent.matrix @ rest[parent.name].inverted() @ heads[arm]
            length = (heads[elbow] - heads[arm]).length
            sign = 1 if heads[arm].x > 0 else -1
            swing = -.60 * math.cos(p) if running else .06 * math.sin(theta)
            direction = Vector((sign * .15, forward*swing, -.82)).normalized()
            elbow_pos = shoulder + direction * length
            aim(arm, shoulder, elbow_pos, heads[elbow])
            reach = Vector((sign * .08, forward*.88, .32 + .22*math.cos(p))) if running else Vector((sign*.03, forward*.12, -.98))
            hand_pos = elbow_pos + reach.normalized() * (heads[hand] - heads[elbow]).length
            aim(elbow, elbow_pos, hand_pos, heads[hand])
            # The hand inherits the forearm transform, preserving its original bind grip.
            set_matrix(hand, rig.pose.bones[elbow].matrix @ rest[elbow].inverted() @ rest[hand])
        for name in ('Tail', 'Hair'):
            if name in rig.pose.bones:
                rig.pose.bones[name].rotation_mode = 'XYZ'
                rig.pose.bones[name].rotation_euler.x += .065 * math.sin(theta + .4)

    for name, frames, running in [('Run', 24, True), ('Idle', 90, False)]:
        old = bpy.data.actions.get(name)
        if old:
            bpy.data.actions.remove(old)
        action = bpy.data.actions.new(name)
        ad.action = action
        for frame in range(frames + 1):
            scene.frame_set(frame)
            pose(frame / frames, running)
            for bone in rig.pose.bones:
                bone.rotation_mode = 'QUATERNION'
                bone.keyframe_insert('location', frame=frame, group=bone.name)
                bone.keyframe_insert('rotation_quaternion', frame=frame, group=bone.name)
                bone.keyframe_insert('scale', frame=frame, group=bone.name)
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        for key in curve.keyframe_points:
                            key.interpolation = 'LINEAR'
        action.use_fake_user = True
    ad.action = None
    for action in bpy.data.actions:
        track = ad.nla_tracks.new()
        track.name = action.name
        strip = track.strips.new(action.name, 0, action)
        strip.action_frame_start, strip.action_frame_end = 0, action.frame_range[1]
        strip.frame_start = 0
        strip.frame_end = action.frame_range[1]
        track.mute = True
    rig['thunderMotionVersion'] = 2
    rig['motionNotes'] = 'Authored contact/recovery stride, counter-swing, seamless idle; no runtime swing amplification.'
    scene.frame_set(0)
