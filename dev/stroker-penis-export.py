# dev/stroker-penis-export.py -- the Stroker's realistic penis (paw-45rb): src/features/machine/bodies/stroker-penis.glb
# from the source model, in headless Blender (4.3; never the file's own scripts):
#   blender -b --disable-autoexec penis_simple_v2.2.blend --python-exit-code 1 -P dev/stroker-penis-export.py -- <out.glb>
# Source: "Easy penis auto-rigger" v2.2 by Likkez (penis_simple_v2.2.blend, from the upload's page; its rig script's
# header spells the name "Likkezg" and asks "Give credit if you use the dick model!"), dedicated CC0 1.0 by its uploader.
# The .blend itself never enters the repo; credit in NOTICE and THIRD-PARTY.md.
#
# What it writes (mm; y along the penis from its visible base (0) to the tip, z its top (dorsal), x = y cross z; a node
# scale of 0.001 makes it metres in any glTF viewer):
#  - mesh "penis": the shaft and glans resampled as a grid of rings (rest pose, the author's shape keys, subdivision 2,
#    no displacement): rays from the rig's own centre line (its bone chain: the pose straightened) at SEG angles per
#    station, denser over the glans and the corona; the dome by rays from a point inside the glans; a pole at the tip;
#    under the base the root (the base ring carried ROOT mm on, shown when the pubic pad is pressed in). Vertex order:
#    the pole, then each ring (tip -> root) of SEG vertices at theta = 2 pi j / SEG (x = r cos, z = r sin).
#    _ZONES (u8 x 4, normalized, glans / corona / shaft / base; the rest is scrotum): from the geometry, the stroker's
#    zones (stroker.js zoneOf) with the glans boundary following the corona's rim round the shaft.
#  - mesh "scrotum": the source's scrotum faces (its balls_* vertex groups dominant), subdivision 1, its open edges filled,
#    in the same frame.
#  - asset.extras: lengthMm (tip), glansMm, shaftR (the mean radius mid-shaft: girth / 2 pi), rootMm, seg, rings, credit.
import bpy, bmesh, json, math, struct, sys
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

OUT = sys.argv[sys.argv.index('--') + 1]
SEG, ROOT, SHAFT_R = 48, 40.0, 120 / (2 * math.pi)   # angles per ring; the root (mm, the pad's deepest); the default girth's radius
A_BASE = 0.026          # the visible base along the bone chain (source units): the first station the penis faces close round
CAP_PHI = [6, 14, 23, 32, 41, 50, 59, 68, 77]   # the dome's rings (degrees from the axis), the pole before them
CREDIT = '"Easy penis auto-rigger" v2.2 by Likkez, CC0 1.0 (credit requested by the author)'

ob, arm = bpy.data.objects['penis'], bpy.data.objects['character_rig']
arm.data.pose_position = 'REST'


def evaluated(levels):
    for md in ob.modifiers:
        if md.type == 'SUBSURF': md.levels = levels; md.show_viewport = levels > 0
        if md.type in ('DISPLACE', 'DATA_TRANSFER'): md.show_viewport = False
    dg = bpy.context.evaluated_depsgraph_get()
    me = ob.evaluated_get(dg).to_mesh()
    names = [g.name for g in ob.vertex_groups]
    cls = []   # 0 penis, 1 scrotum, 2 the body patch round the base
    for v in me.vertices:
        p = b = o = 0.0
        for g in v.groups:
            n = names[g.group]
            if n.startswith('penis_') and n not in ('penis_attach_vertex_groups', 'penis_seam_normals'): p += g.weight
            elif n.startswith('balls_'): b += g.weight
            elif n not in ('Group', 'penis_attach_vertex_groups', 'penis_seam_normals', 'weights_body_transfer'): o += g.weight
        cls.append(0 if p >= max(b, o) else 1 if b >= o else 2)
    return me, [ob.matrix_world @ v.co for v in me.vertices], cls


# ---- the centre line: the bone chain, base -> tip ----
chain = [arm.matrix_world @ arm.data.bones['penis_1_def'].head_local] + [arm.matrix_world @ arm.data.bones['penis_%d_def' % i].tail_local for i in range(1, 8)]
seg_len = [(chain[i + 1] - chain[i]).length for i in range(7)]
UPZ = Vector((0, 0, 1))


def frame(a):
    """Centre and frame (x, t: toward the tip, z: up) a source units along the chain."""
    for i in range(7):
        if a <= seg_len[i] or i == 6:
            t = (chain[i + 1] - chain[i]).normalized()
            c = chain[i] + t * a
            z = (UPZ - t * UPZ.dot(t)).normalized()
            return c, t.cross(z), t, z
        a -= seg_len[i]


me, V, cls = evaluated(2)
pen = [f for f in me.polygons if sum(cls[i] == 0 for i in f.vertices) * 2 > len(f.vertices)]
bvh = BVHTree.FromPolygons(V, [tuple(f.vertices) for f in pen])
TH = [2 * math.pi * j / SEG for j in range(SEG)]


def cast(c, d):
    h = bvh.ray_cast(c, d, 0.3)
    return h[3] if h[0] is not None else float('nan')


def radial(a):
    c, x, t, z = frame(a)
    r = np.array([cast(c, x * math.cos(th) + z * math.sin(th)) for th in TH])
    med = np.nanmedian(r)
    return np.where(np.isnan(r), med, np.minimum(r, 1.12 * med))   # (a miss, or the scrotum's root under the base: the median's)


# the tip and the dome's centre: rays along the axis from inside the glans
a_tipguess = sum(seg_len)
c, x, t, z = frame(a_tipguess - 0.02)
a_tip = a_tipguess - 0.02 + cast(c, t)
rs = {round(a, 5): radial(a) for a in np.arange(A_BASE, a_tip - 0.004, 0.001)}
r_mean = lambda a: float(np.mean(radial(a)))
a_mid = A_BASE + (a_tip - A_BASE) / 2
SCALE = SHAFT_R / r_mean(a_mid)   # source units -> mm: the mean radius mid-shaft is the default girth's
mm = lambda a: (a - A_BASE) * SCALE     # chain position -> y (mm from the base)
L0 = mm(a_tip)
# the corona's rim: from the tip, the first local maximum of the mean radius (the widest within 3 mm either side)
rm = {a: float(np.mean(r)) for a, r in rs.items()}
near = lambda a: [rm[b] for b in rm if abs(mm(b) - mm(a)) <= 3]
a_ridge = next(a for a in sorted(rm, reverse=True) if L0 - mm(a) > 6 and rm[a] >= max(near(a)))
s_ridge = L0 - mm(a_ridge)
G0 = s_ridge / 0.95                     # (stroker.js: the corona's ridge at 0.95 of the glans length)
print('L0 %.1f mm, ridge at %.1f mm from the tip, glans %.1f mm, scale %.1f mm per unit' % (L0, s_ridge, G0, SCALE))

# ---- rings: stations as mm from the tip (s), dense over the glans and the corona ----
a_cap = a_tip - 0.6 * r_mean(a_tip - 0.014)   # the dome's centre
s_cap = L0 - mm(a_cap)
stations, s = [], s_cap
while s < L0:
    stations.append(s)
    s += 1.0 if s < G0 + 10 else 1.5 if s < G0 + 22 else 3.0
stations.append(L0)
rings = []   # [(positions SEG x 3)]
cc, cx, ct, cz = frame(a_cap)
for phi in CAP_PHI:
    f = math.radians(phi)
    ring = []
    for th in TH:
        d = ct * math.cos(f) + (cx * math.cos(th) + cz * math.sin(th)) * math.sin(f)
        h = cast(cc, d)
        ring.append((h * math.sin(f) * math.cos(th) * SCALE, mm(a_cap) + h * math.cos(f) * SCALE, h * math.sin(f) * math.sin(th) * SCALE))
    rings.append(ring)
for s in stations:
    a = A_BASE + (L0 - s) / SCALE
    r = radial(a) * SCALE
    rings.append([(r[j] * math.cos(th), L0 - s, r[j] * math.sin(th)) for j, th in enumerate(TH)])
base = rings[-1]
for k in (1, 2, 3, 4):   # the root: the base ring carried on under the pad
    rings.append([(p[0], -ROOT * k / 4, p[2]) for p in base])
pole = (0.0, mm(a_cap) + cast(cc, ct) * SCALE, 0.0)
P = np.array([pole] + [p for ring in rings for p in ring], dtype=np.float32)
assert not np.isnan(P).any(), 'a ray missed in the dome'
tip = float(P[:, 1].max())   # the tip: the meatus's lips (the pole sits a hair back, in the slit)
s_ridge += tip - L0; G0 = s_ridge / 0.95; L0 = tip
NR = len(rings)
idx = []
for j in range(SEG):   # the pole's fan, then quads between rings (outward: counter-clockwise seen from outside)
    idx += [0, 1 + (j + 1) % SEG, 1 + j]
for k in range(NR - 1):
    for j in range(SEG):
        a0, a1 = 1 + k * SEG + j, 1 + k * SEG + (j + 1) % SEG
        b0, b1 = a0 + SEG, a1 + SEG
        idx += [a0, a1, b0, a1, b1, b0]
I = np.array(idx, dtype=np.uint16).reshape(-1, 3)


def normals(P, I):
    fn = np.cross(P[I[:, 1]] - P[I[:, 0]], P[I[:, 2]] - P[I[:, 0]])
    N = np.zeros_like(P)
    for c in range(3): np.add.at(N, I[:, c], fn)
    return N / np.maximum(1e-12, np.linalg.norm(N, axis=1))[:, None], fn


N, fn = normals(P, I)
cent = P[I].mean(1)
if np.sum(np.einsum('ij,ij->i', fn, cent * [1, 0, 1])) < 0:   # (outward, away from the axis)
    I = I[:, ::-1].copy(); N, fn = normals(P, I)

# ---- zones per vertex: the corona's rim per angle (the widest within 5 mm of the mean rim), smoothed round the shaft ----
S = L0 - P[:, 1]                         # mm from the tip
R = np.hypot(P[:, 0], P[:, 2])
grid = lambda k, j: 1 + k * SEG + j
rim = np.zeros(SEG)
for j in range(SEG):
    ks = [k for k in range(NR) if abs(S[grid(k, j)] - s_ridge) <= 5]
    rim[j] = S[grid(max(ks, key=lambda k: R[grid(k, j)]), j)]
rim = np.array([np.median(np.take(rim, range(j - 3, j + 4), mode='wrap')) for j in range(SEG)])
col = np.array([0] + [j for k in range(NR) for j in range(SEG)])
g = G0 + (rim[col] - s_ridge)            # the glans length along this angle
corona = np.clip(np.minimum(S - (g - 3), (g + 4) - S) + 0.5, 0, 1)
behind = (S > g).astype(float)
mid = (G0 + 4 + L0) / 2
b = np.clip((S - mid) / 2 + 0.5, 0, 1)
Z = np.stack([(1 - corona) * (1 - behind), corona, (1 - corona) * behind * (1 - b), (1 - corona) * behind * b], 1)
Zq = np.floor(Z * 255).astype(int)
for i in range(len(Zq)):                 # largest remainder: each vertex's four sum to 255 exactly
    short = 255 - Zq[i].sum()
    for c in np.argsort(-(Z[i] * 255 - Zq[i]))[:short]: Zq[i, c] += 1
Zq = Zq.astype(np.uint8)

# ---- the scrotum: its faces at subdivision 1, open edges filled, in the base's frame ----
me1, V1, cls1 = evaluated(1)
bm = bmesh.new(); bm.from_mesh(me1)
bm.verts.ensure_lookup_table()
for v in bm.verts: v.co = V1[v.index]
bmesh.ops.delete(bm, geom=[f for f in bm.faces if sum(cls1[v.index] == 1 for v in f.verts) * 2 <= len(f.verts)], context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
bmesh.ops.triangulate(bm, faces=bm.faces[:])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
bm.verts.index_update(); bm.normal_update()
c0, x0, t0, z0 = frame(A_BASE)
to = lambda p: ((p - c0).dot(x0) * SCALE, (p - c0).dot(t0) * SCALE, (p - c0).dot(z0) * SCALE)
SP = np.array([to(v.co) for v in bm.verts], dtype=np.float32)
SN = np.array([(v.normal.dot(x0), v.normal.dot(t0), v.normal.dot(z0)) for v in bm.verts], dtype=np.float32)
SI = np.array([[v.index for v in f.verts] for f in bm.faces], dtype=np.uint16)
print('penis %d verts %d tris; scrotum %d verts %d tris' % (len(P), len(I), len(SP), len(SI)))

# ---- the .glb ----
blob, views, accs = bytearray(), [], []


def add(arr, ctype, typ, normalized=False, minmax=False):
    while len(blob) % 4: blob.append(0)
    views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': arr.nbytes})
    blob.extend(arr.tobytes())
    a = {'bufferView': len(views) - 1, 'componentType': ctype, 'count': len(arr), 'type': typ}
    if normalized: a['normalized'] = True
    if minmax: a['min'] = [float(x) for x in arr.min(0)]; a['max'] = [float(x) for x in arr.max(0)]
    accs.append(a)
    return len(accs) - 1


F, U8, U16 = 5126, 5121, 5123
penis = {'POSITION': add(P, F, 'VEC3', minmax=True), 'NORMAL': add(N.astype(np.float32), F, 'VEC3'), '_ZONES': add(Zq, U8, 'VEC4', normalized=True)}
pi = add(I.reshape(-1), U16, 'SCALAR')
scrot = {'POSITION': add(SP, F, 'VEC3', minmax=True), 'NORMAL': add(SN, F, 'VEC3')}
si = add(SI.reshape(-1), U16, 'SCALAR')
while len(blob) % 4: blob.append(0)
gltf = {
    'asset': {'version': '2.0', 'generator': 'dev/stroker-penis-export.py', 'copyright': CREDIT,
              'extras': {'lengthMm': round(float(L0), 3), 'glansMm': round(float(G0), 3), 'shaftR': round(SHAFT_R, 4), 'rootMm': ROOT, 'seg': SEG, 'rings': NR, 'credit': CREDIT}},
    'scene': 0, 'scenes': [{'nodes': [0, 1]}],
    'nodes': [{'name': 'penis', 'mesh': 0, 'scale': [0.001] * 3}, {'name': 'scrotum', 'mesh': 1, 'scale': [0.001] * 3}],
    'meshes': [{'name': 'penis', 'primitives': [{'attributes': penis, 'indices': pi}]}, {'name': 'scrotum', 'primitives': [{'attributes': scrot, 'indices': si}]}],
    'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(blob)}],
}
js = json.dumps(gltf, separators=(',', ':')).encode()
js += b' ' * (-len(js) % 4)
glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(blob), 0x004E4942) + bytes(blob)
open(OUT, 'wb').write(glb)
print('wrote %s: %d bytes, %d triangles' % (OUT, len(glb), len(I) + len(SI)))
