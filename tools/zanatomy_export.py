# tools/zanatomy_export.py -- the Machine panel's Human body from the Z-Anatomy atlas (paw-27u0): posed on all fours,
# head removed, kidneys replaced by generated shapes, split into layers, written as raw buffers for
# tools/build-body-layers.mjs. Run Blender in background mode on a COPY of Z-Anatomy's Startup.blend:
#
#   blender -b --factory-startup --disable-autoexec -t 4 <copy of Startup.blend> --python tools/zanatomy_export.py -- <out dir>
#   (or on <out dir>/human-posed.blend, the posed model it saves, after editing it in Blender: straight to the layers)
#
# What it does (the file is a standing male, Z up, metres, -Y = anterior, +X = his left):
#  - layers: skin (the "Regions of human body" patches, hair left out, welded into one surface, subdivided once after
#    posing), skeleton (every bone, the intervertebral discs, the sacrococcygeal and interpubic discs), and the organs
#    by group (GROUPS, paw-mr7f): colon (the whole colon; Z-Anatomy's "Sigmoid colon" object is the rectum), small
#    intestine, stomach and oesophagus, bladder, prostate and genitals (with the ducts), kidneys (generated) and
#    adrenals with the ureters, liver / gallbladder / pancreas / spleen, lungs / heart / trachea. Muscles, vessels and
#    nerves are left out (the owner: not the point).
#  - the head: every layer is cut by a plane at the base of the neck (just above the jugular notch in front, C7 at the
#    back), so the skull, brain, face, eyes, ears (the inner ear: CC-BY-NC-SA) and the cervical parts above it go; the
#    panel fades the last few cm to transparent from the plane in the json.
#  - kidneys: the file's kidney model is CC-BY-NC: its geometry is never exported (nor the renal pelvis that comes
#    with it); a generated bean of the same size, place and orientation (the original's principal axes) stands in.
#  - the pose: the file is not rigged. Joint centres come from the bones (sphere fits of the femoral and humeral
#    heads, the knee, ankle, elbow and wrist from the bone ends); every segment is rigid (bones and organs follow
#    their segment; the torso, pelvis and every organ in it are one rigid piece, the spine kept as it stands); the
#    skin is skinned with weights computed here from position and its patch names (dual quaternions, so the hips,
#    knees and shoulders keep their volume): hips flexed so the thighs stand vertical, knees at 90 deg with the shins
#    on the floor, feet pointed back, arms flexed down to the floor with the forearms pronated (the radius turned
#    about the radial-head / ulnar-head axis, the forearm's skin twisted along its length) and the wrists extended,
#    palms flat, fingers forward. The torso's pitch is solved so knees and palms meet one floor. The thighs spread
#    HIP_ABDUCTION each side (the knees ~1.7 x the hip joints apart), the shins parallel behind them; the ankle turns
#    about the malleoli's tips, its skin by direction from the joint (the instep with the tarsals, the heel round the
#    calcaneus) and its front drawn taut over the tendons; the gap at the perineum is closed (paw-641i).
#  - <out>/human-posed.blend: the posed, cut model, one collection per layer, to sculpt on; run this script on it
#    (after editing) to rebuild the layers from it instead of re-posing the atlas. PW_DEBUG_JOINT=<joint> prints the
#    skin vertices that moved most against their bones near that joint.
#  - colours: a per-tissue palette (the file's materials are node groups); flat per object.
#  - out: <layer>.pos.f32 / .nor.f32 / .col.u8 (rgb sRGB + a part flag: 1 skin, 3 the bone line (sacrum, lumbar and
#    thoracic spine), 5 the coccyx, 4 the colon the toy's path runs in, 0 the rest) / .idx.u32, Y up, Z toward the head, metres; and
#    manifest.json (landmarks, the cut plane, the colon's centre line, the measured height, counts).
import bpy, bmesh, sys, os, json, math
import numpy as np
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
os.makedirs(OUT, exist_ok=True)
S = lambda x: (lambda t: t * t * (3 - 2 * t))(max(0.0, min(1.0, x)))

# ---------------------------------------------------------------- per layer: join, subdivide the skin, decimate, write
def write_layers(objs, manifest):
    TARGET = {'skin': 140000, 'skeleton': 160000, 'colon': 22000, 'small': 14000, 'stomach': 9000, 'bladder': 3000, 'genitals': 15000, 'kidneys': 10000, 'liver': 22000, 'thorax': 23000}
    layers = {}
    for name, (o, L) in objs.items(): layers.setdefault(L, []).append(o)
    for L, olist in layers.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in olist: o.select_set(True)
        bpy.context.view_layer.objects.active = olist[0]
        if len(olist) > 1: bpy.ops.object.join()
        o = olist[0]; me = o.data; src_tris = sum(len(p.vertices) - 2 for p in me.polygons)
        if L == 'skin':
            m = o.modifiers.new('sub', 'SUBSURF'); m.levels = 1; m.render_levels = 1
            bpy.ops.object.modifier_apply(modifier='sub')
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        if tris > TARGET[L]:
            m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = TARGET[L] / tris; m.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier='dec')
        me = o.data
        for p in me.polygons: p.use_smooth = True
        me.update(); me.calc_loop_triangles()
        nv = len(me.vertices); pos = np.empty(nv * 3, np.float32); me.vertices.foreach_get('co', pos)
        nor = np.empty(nv * 3, np.float32); me.vertices.foreach_get('normal', nor)
        col = np.empty(nv * 4, np.float32); me.color_attributes['pw'].data.foreach_get('color', col)
        idx = np.empty(len(me.loop_triangles) * 3, np.uint32); me.loop_triangles.foreach_get('vertices', idx)
        pos = pos.reshape(-1, 3)[:, [0, 2, 1]] * np.array([1, 1, -1], np.float32); nor = nor.reshape(-1, 3)[:, [0, 2, 1]] * np.array([1, 1, -1], np.float32)
        c = col.reshape(-1, 4); rgb = np.where(c[:, :3] <= 1, c[:, :3], 1)
        cu8 = np.c_[np.round(rgb * 255), np.round(c[:, 3] * 255)].astype(np.uint8)
        pos.astype(np.float32).tofile(os.path.join(OUT, L + '.pos.f32')); nor.astype(np.float32).tofile(os.path.join(OUT, L + '.nor.f32'))
        cu8.tofile(os.path.join(OUT, L + '.col.u8')); idx.tofile(os.path.join(OUT, L + '.idx.u32'))
        manifest['layers'][L] = {'vertices': nv, 'triangles': len(me.loop_triangles), 'sourceTriangles': src_tris}
        print('layer', L, manifest['layers'][L])
    manifest['objects'] = {L: sorted(n for n, (o, LL) in objs.items() if LL == L) for L in layers}
    json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
    print('done')

def save_posed(objs, manifest):
    """The posed, cut model as <out>/human-posed.blend: one collection per layer (pw:<layer>), the manifest in a text
    block; to sculpt or adjust it in Blender and rebuild the asset from it (run this script on it: --from-posed is
    automatic when the file has that text block)."""
    sc = bpy.data.scenes.new('Human (posed)'); cols = {}
    for name, (o, L) in objs.items():
        c = cols.get(L) or bpy.data.collections.new('pw:' + L); cols[L] = c
        if c.name not in sc.collection.children: sc.collection.children.link(c)
        c.objects.link(o)
    t = bpy.data.texts.new('pawscript_manifest'); t.write(json.dumps(manifest))
    bpy.data.libraries.write(os.path.join(OUT, 'human-posed.blend'), {sc, t}, fake_user=True, compress=True)
    print('posed model saved:', os.path.join(OUT, 'human-posed.blend'))

# ---------------------------------------------------------------- what goes where
# the inner layers, by organ group (paw-mr7f): each can be shown on its own, at its own opacity
GROUPS = {
    'colon': ['Sigmoid colon', 'Descending colon', 'Transverse colon', 'Ascending colon', 'Vermiform appendix'],
    'small': ['Duodenum', 'Jejunum'],
    'stomach': ['Stomach', 'Oesophagus'],
    'bladder': ['Urinary bladder'],
    'genitals': ['Prostate', 'Seminal gland.l', 'Seminal gland.r', 'Testis.l', 'Testis.r', 'Epididymis.l', 'Epididymis.r', 'Glans penis', 'Corpus cavernosum of penis',
                 'Corpus spongiosum of penis', 'Urethra', 'Ductus deferens.l', 'Ductus deferens.r', 'Ejaculatory duct.l', 'Ejaculatory duct.r'],
    'kidneys': ['Suprarenal gland.l', 'Suprarenal gland.r', 'Ureter.l', 'Ureter.r'],   # + the two generated kidneys
    'liver': ['Liver', 'Gallbladder', 'Pancreas', 'Spleen'],
    'thorax': ['Superior lobe of right lung', 'Middle lobe of right lung', 'Inferior lobe of right lung', 'Superior lobe of left lung', 'Inferior lobe of left lung',
               'Right atrium', 'Right ventricle', 'Left atrium', 'Left ventricle', 'Pulmonary trunk', 'Trachea'],
}
GROUP_OF = {n: g for g, ns in GROUPS.items() for n in ns}
KIDNEYS = ['Kidney.l', 'Kidney.r']
JOINT_KEEP = ('Intervertebral disc', 'Sacrococcygeal symphysis', 'Interpubic disc')
BONE_LINE = ('Sacrum', 'Vertebra', 'Intervertebral disc')
COCCYX = ('Coccyx', 'Sacrococcygeal symphysis')
PATH_COLON = ('Sigmoid colon', 'Descending colon')
NO_SKIN = ('Hairs', 'Eyelashes', 'Pubic hairs', 'Regions of human body')
HEX = lambda h: tuple(int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))
COLOUR = {'skin': HEX('#c4b2a2'), 'nail': HEX('#d8c3b6'), 'bone': HEX('#e4dac7'), 'disc': HEX('#aebfc6'), 'tooth': HEX('#f0ead8'),
          'Sigmoid colon': HEX('#c86f62'), 'Descending colon': HEX('#c47466'), 'colon': HEX('#c47a6a'), 'Stomach': HEX('#cf8a78'), 'small': HEX('#d8907c'), 'Oesophagus': HEX('#c97e70'),
          'Urinary bladder': HEX('#d8b25c'), 'Prostate': HEX('#c9744c'), 'gland': HEX('#cf8a5a'), 'testis': HEX('#d9a7a0'), 'penis': HEX('#c98a86'), 'duct': HEX('#e2d39a'), 'kidney': HEX('#8b3a31'),
          'Liver': HEX('#7d2f25'), 'Gallbladder': HEX('#4f7a3a'), 'Pancreas': HEX('#dca46a'), 'Spleen': HEX('#6e2b3b'), 'Suprarenal': HEX('#d6a24a'), 'lung': HEX('#d99a94'),
          'heart': HEX('#a63c3a'), 'Trachea': HEX('#cfc0b0')}

def colour_of(layer, name):
    if layer == 'skin': return COLOUR['nail'] if 'Nail' in name or 'Perionyx' in name else COLOUR['skin']
    if layer == 'skeleton': return COLOUR['disc'] if any(name.startswith(k) for k in JOINT_KEEP) or 'cartilage' in name.lower() else COLOUR['bone']
    for k in (name, name.split('.')[0]):
        if k in COLOUR: return COLOUR[k]
    n = name.lower()
    for key, c in (('colon', 'colon'), ('appendix', 'colon'), ('duoden', 'small'), ('jejun', 'small'), ('seminal', 'gland'), ('testis', 'testis'), ('epididym', 'testis'), ('penis', 'penis'),
                   ('ureter', 'duct'), ('urethra', 'duct'), ('duct', 'duct'), ('suprarenal', 'Suprarenal'), ('lung', 'lung'), ('atrium', 'heart'), ('ventricle', 'heart'), ('trunk', 'heart')):
        if key in n: return COLOUR[c]
    return (0.75, 0.6, 0.55)

def layer_of(o):
    cs = {c.name for c in o.users_collection}
    n = o.name
    if n.endswith(('.g', '.j', '.t', '.i')): return None
    if '9: Regions of human body' in cs and o.type == 'MESH': return None if any(k in n for k in NO_SKIN) else 'skin'
    if '1: Skeletal system' in cs and o.type == 'MESH': return 'skeleton'
    if '3: Joints' in cs and n.startswith(JOINT_KEEP): return 'skeleton'
    if n in GROUP_OF: return GROUP_OF[n]
    return None

# ---------------------------------------------------------------- an edited posed model (save_posed's .blend): straight to the layers
if bpy.data.texts.get('pawscript_manifest'):
    manifest = json.loads(bpy.data.texts['pawscript_manifest'].as_string()); manifest['layers'] = {}
    objs = {}
    for c in bpy.data.collections:
        if c.name.startswith('pw:'):
            for o in c.objects:
                if o.type == 'MESH': objs[o.name[3:] if o.name.startswith('pw:') else o.name] = (o, c.name[3:])
    skin = next(o for o, L in objs.values() if L == 'skin')
    # mesh edits (sculpting the skin) may move the opening: found again on the sphincter's axis
    BX = lambda p: Vector((p[0], -p[2], p[1]))
    for o, L in objs.values():   # modifiers the owner added (subdivision, ...) applied as they show; moved objects baked in
        if o.modifiers: dg = bpy.context.evaluated_depsgraph_get(); me = bpy.data.meshes.new_from_object(o.evaluated_get(dg)); o.modifiers.clear(); o.data = me
        o.data.transform(o.matrix_world); o.matrix_world = Matrix.Identity(4)
    bvh = BVHTree.FromObject(skin, bpy.context.evaluated_depsgraph_get())
    c0, a0 = BX(manifest['sphincter']['centre']), BX(manifest['sphincter']['axis'])
    hit = bvh.ray_cast(c0, a0)[0]
    if hit: manifest['opening'] = [round(hit[0], 6), round(hit[2], 6), round(-hit[1], 6)]
    print('from the posed model:', len(objs), 'objects; opening', manifest['opening'])

    write_layers(objs, manifest); sys.exit(0)

# ---------------------------------------------------------------- copies of what is kept, modifiers applied but no solidify
scene = bpy.context.scene
keep = {}
for o in scene.objects:
    if o.type not in ('MESH', 'CURVE'): continue
    L = layer_of(o)
    if L or o.name in KIDNEYS or o.name.startswith('External anal sphincter'): keep[o.name] = (o, L)
for o, _ in keep.values():
    for m in o.modifiers:
        if m.type == 'SOLIDIFY': m.show_viewport = False
dg = bpy.context.evaluated_depsgraph_get()
dg.update()
pw = bpy.data.collections.new('PW'); scene.collection.children.link(pw)
objs, skipped = {}, []
for name, (o, L) in keep.items():
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), depsgraph=dg)
    me.transform(o.matrix_world)
    if not me.polygons: skipped.append(name); bpy.data.meshes.remove(me); continue
    n = bpy.data.objects.new('pw:' + name, me); pw.objects.link(n)
    objs[name] = (n, L)
for c in list(scene.collection.children):
    if c != pw: scene.collection.children.unlink(c)
for o in list(scene.collection.objects): scene.collection.objects.unlink(o)
print('kept', len(objs), 'skipped (no surface):', skipped)
V = lambda name: np.array([v.co[:] for v in objs[name][0].data.vertices])

def standing_height():
    zs = [v.co.z for n, (o, L) in objs.items() if L == 'skin' for v in o.data.vertices]
    return max(zs) - min(zs), min(zs)
HEIGHT, FLOOR0 = standing_height()
print('standing height (skin, hair excluded) %.4f m' % HEIGHT)

# ---------------------------------------------------------------- joint centres (standing)
def sphere_fit(P):
    A = np.c_[2 * P, np.ones(len(P))]; b = (P ** 2).sum(1)
    x = np.linalg.lstsq(A, b, rcond=None)[0]
    return Vector(x[:3]), math.sqrt(max(1e-12, x[3] + (x[:3] ** 2).sum()))
def head_of(name, band):
    P = V(name); top = P[:, 2].max(); c = P[P[:, 2] > top - band]; mx = np.abs(c[:, 0]).min()
    return sphere_fit(c[np.abs(c[:, 0]) < mx + band])
J = {}
for s, sx in (('l', 1), ('r', -1)):
    hip, hr = head_of('Femur.' + s, 0.045)
    F = V('Femur.' + s); fb = F[:, 2].min(); d = F[F[:, 2] < fb + 0.04]
    knee = Vector((d[:, 0].mean(), d[:, 1].mean(), fb + 0.025))
    # the ankle's axis runs through the malleoli's tips (the lowest points of the tibia and the fibula); the talus's box
    # centre (paw-27u0) sat high and forward of it, so the instep swung wide and bulged (paw-641i)
    Tb, Fb = V('Tibia.' + s), V('Fibula.' + s); ankle = (Vector(Tb[Tb[:, 2].argmin()]) + Vector(Fb[Fb[:, 2].argmin()])) / 2
    sh, sr = head_of('Humerus.' + s, 0.035)
    H = V('Humerus.' + s); hb = H[:, 2].min(); e = H[H[:, 2] < hb + 0.03]
    elbow = Vector((e[:, 0].mean(), e[:, 1].mean(), hb + 0.015))
    R = V('Radius.' + s); rt = R[:, 2].max(); rh = R[R[:, 2] > rt - 0.015]; rhead = Vector(rh.mean(0))
    U = V('Ulna.' + s); ub = U[:, 2].min(); uh = U[U[:, 2] < ub + 0.02]; uhead = Vector(uh.mean(0))
    wrist = (Vector(V('Lunate bone.' + s).mean(0)) + Vector(V('Capitate bone.' + s).mean(0))) / 2
    J[s] = dict(hip=hip, knee=knee, ankle=ankle, shoulder=sh, elbow=elbow, rhead=rhead, uhead=uhead, wrist=wrist, sx=sx, hipR=hr, shR=sr)
    print(s, {k: [round(x, 4) for x in v] if isinstance(v, Vector) else v for k, v in J[s].items()})

# ---------------------------------------------------------------- the cut plane at the base of the neck (standing)
man_top = V('Manubrium of sternum')[:, 2].max(); c7 = V('Vertebra C7'); c7_top = c7[:, 2].max()
front = Vector((0, V('Manubrium of sternum')[:, 1].min(), man_top + 0.02)); back = Vector((0, c7[:, 1].max(), c7_top))
tang = (back - front).normalized(); CUT_N = Vector((0, -tang.z, tang.y)).normalized()   # up and a little forward
if CUT_N.z < 0: CUT_N = -CUT_N
CUT_P = (front + back) / 2
FADE, NECK_R = 0.06, (0.085, 0.12)
print('cut plane through', [round(x, 4) for x in CUT_P], 'normal', [round(x, 4) for x in CUT_N])

# ---------------------------------------------------------------- landmarks from the original anatomy (standing)
sph = np.r_[V('External anal sphincter.l'), V('External anal sphincter.r')]
sph_c = Vector(sph.mean(0)); w, ev = np.linalg.eigh(np.cov((sph - sph.mean(0)).T)); sph_ax = Vector(ev[:, 0])   # the ring's axis: least spread
if sph_ax.z > 0: sph_ax = -sph_ax   # pointing out of the body (down and back)
kid = {}
for k in KIDNEYS:
    P = V(k); c = P.mean(0); w, ev = np.linalg.eigh(np.cov((P - c).T))
    ax = [Vector(ev[:, i]) for i in (2, 1, 0)]   # long, middle, short
    ext = [max(abs((P - c) @ np.array(a[:]))) for a in ax]
    kid[k] = (Vector(c), ax, ext)

# ---------------------------------------------------------------- cut, kidneys, colour, flags
def cut(o):
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=CUT_P, plane_no=CUT_N, clear_outer=True)
    bm.to_mesh(o.data); bm.free()
    return len(o.data.polygons) > 0
for name in list(objs):
    o, L = objs[name]
    if name in KIDNEYS or name.startswith('External anal sphincter') or not cut(o):
        me = o.data; bpy.data.objects.remove(o); bpy.data.meshes.remove(me)
        del objs[name]

def kidney_blob(name, c, ax, ext):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=24, radius=1.0)
    med = Vector((-math.copysign(1, c.x), 0, 0)); med = med - ax[0] * med.dot(ax[0]); med.normalize()
    ml = Vector((0, med.dot(ax[1]), med.dot(ax[2]))).normalized()
    for v in bm.verts:
        p = v.co.copy(); d = max(0.0, p.dot(ml))
        p -= ml * (0.42 * d ** 2.2 * max(0.0, 1 - p.x ** 2) ** 1.5)   # the hilum: a dent on the medial side, deepest mid-length
        v.co = c + ax[0] * (p.x * ext[0] * 0.97) + ax[1] * (p.y * ext[1] * 0.97) + ax[2] * (p.z * ext[2] * 0.97)
    me = bpy.data.meshes.new('pw:' + name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    o = bpy.data.objects.new('pw:' + name + ' (generated)', me); pw.objects.link(o)
    objs[name + ' (generated)'] = (o, 'kidneys')
for k, (c, ax, ext) in kid.items(): kidney_blob(k, c, ax, ext)

def flag_of(L, name):
    if L == 'skin': return 1
    if L == 'skeleton' and name.startswith(COCCYX): return 5
    if L == 'skeleton' and name.startswith(BONE_LINE): return 3
    if name in PATH_COLON: return 4
    return 0
for name, (o, L) in objs.items():
    me = o.data
    rgb = COLOUR['kidney'] if 'generated' in name else colour_of(L, name)
    a = me.color_attributes.new('pw', 'FLOAT_COLOR', 'POINT')
    f = flag_of(L, name) / 255.0
    a.data.foreach_set('color', [x for _ in range(len(me.vertices)) for x in (*rgb, f)])

# ---------------------------------------------------------------- segments
LEG = ('Femur', 'Patella'), ('Tibia', 'Fibula'), ('Talus', 'Calcaneus', 'Navicular', 'Cuboid', 'cuneiform', 'metatarsal', 'of foot', 'Sesamoid bones of foot')
ARM = ('Humerus', 'Ulna'), ('Radius',), ('bone.', 'metacarpal', 'of hand')
CARPAL = ('Capitate', 'Hamate', 'Lunate', 'Pisiform', 'Scaphoid', 'Trapezium', 'Trapezoid', 'Triquetrum')
def segment_of(name):
    s = name[-1] if name[-2:] in ('.l', '.r') else None
    if s is None or name.startswith(('Hip bone', 'Clavicle', 'Scapula')) or not any(k in name for g in LEG + ARM for k in g): return 'root'
    for seg, keys in zip(('thigh', 'shin', 'foot'), LEG):
        if any(k in name for k in keys): return seg + '.' + s
    if name.startswith(('Humerus', 'Ulna')): return 'uarm.' + s
    if name.startswith('Radius'): return 'radius.' + s
    if name.startswith(CARPAL) or 'metacarpal' in name or 'of hand' in name: return 'hand.' + s
    return 'root'

# ---------------------------------------------------------------- the skin: one welded surface, weights, dual-quaternion skinning
skin_names = [n for n, (o, L) in objs.items() if L == 'skin']
CAT_LEG = ('thigh', 'knee', 'leg.', 'ankle', 'malleol', 'foot', 'Heel', 'Sole', 'arch', 'Hallucial', 'Metatarsal', 'Popliteal', 'Femoral triangle', 'Nail plate (foot)', 'Perionyx (foot)')
CAT_ARM = ('arm.', 'elbow', 'Cubital', 'forearm', 'wrist', 'Palm', 'hand', 'bicipital', 'Radial foveola', 'Deltoid', 'Nail plate.', 'Perionyx.')
def cat_of(n):
    if any(k in n for k in CAT_LEG): return 1
    if any(k in n for k in CAT_ARM): return 2
    if n.startswith('Urogenital region'): return 3
    return 0
for n in skin_names:
    me = objs[n][0].data; a = me.attributes.new('cat', 'FLOAT', 'POINT'); a.data.foreach_set('value', [cat_of(n)] * len(me.vertices))
bpy.ops.object.select_all(action='DESELECT')
for n in skin_names: objs[n][0].select_set(True)
skin = objs[skin_names[0]][0]; bpy.context.view_layer.objects.active = skin
bpy.ops.object.join()
for n in skin_names[1:]: del objs[n]
skin.name = 'pw:skin'
bm = bmesh.new(); bm.from_mesh(skin.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0006)
# the armpits have no patch (closed while the arms hang): fill them before the arms go up
bnd = [e for e in bm.edges if e.is_boundary]; seen = set(); fill = []
for e0 in bnd:
    if e0 in seen: continue
    st, comp = [e0], []
    while st:
        e = st.pop()
        if e in seen: continue
        seen.add(e); comp.append(e); st += [f for v in e.verts for f in v.link_edges if f.is_boundary and f not in seen]
    c = sum((v.co for e in comp for v in e.verts), Vector()) / (2 * len(comp))
    print('skin hole', len(comp), [round(x, 3) for x in c])
    if 0.09 < abs(c.x) < 0.23 and 1.18 < c.z < 1.40 and len(comp) > 6: fill += comp
    # and the gap at the perineum between the anal and urogenital patches (shut as stood, pulled open by the spread
    # thighs: paw-641i)
    elif abs(c.x) < 0.03 and 0.70 < c.z < 0.86 and -0.06 < c.y < 0.08: fill += comp
if fill:
    r = bmesh.ops.holes_fill(bm, edges=fill, sides=1000)
    bmesh.ops.triangulate(bm, faces=r['faces'], quad_method='BEAUTY', ngon_method='BEAUTY')
    print('filled', len(r['faces']), 'holes (armpits, perineum)')
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bvh0 = BVHTree.FromBMesh(bm)
bm.to_mesh(skin.data); bm.free()
objs = {k: v for k, v in objs.items() if v[0] != skin}; objs['skin'] = (skin, 'skin')

def centreline(o, start_pt=None):
    """Bins of geodesic distance (Dijkstra over the edges) from the open end nearest start_pt (or the lowest) -> centroids."""
    me = o.data; n = len(me.vertices); P = np.array([v.co[:] for v in me.vertices])
    adj = [[] for _ in range(n)]
    ec = {}
    for e in me.edges:
        a, b = e.vertices; l = float(np.linalg.norm(P[a] - P[b])); adj[a].append((b, l)); adj[b].append((a, l))
    for p in me.polygons:
        for k in p.edge_keys: ec[k] = ec.get(k, 0) + 1
    bnd = {v for k, c in ec.items() if c == 1 for v in k}
    # the boundary loops (open ends); the source: the loop nearest start_pt, else the lowest
    loops, seen = [], set()
    for v in bnd:
        if v in seen: continue
        st, comp = [v], []
        while st:
            x = st.pop()
            if x in seen: continue
            seen.add(x); comp.append(x); st += [y for y, _ in adj[x] if y in bnd and y not in seen]
        loops.append(comp)
    if start_pt is not None: key = lambda L: np.linalg.norm(P[L].mean(0) - np.array(start_pt[:]))
    else: key = lambda L: P[L][:, 2].mean()
    src = min(loops, key=key) if loops else [int(np.argmin(P[:, 2]))]
    import heapq
    dist = [math.inf] * n; h = [(0.0, s) for s in src]
    for s in src: dist[s] = 0.0
    while h:
        d, x = heapq.heappop(h)
        if d > dist[x]: continue
        for y, l in adj[x]:
            if d + l < dist[y]: dist[y] = d + l; heapq.heappush(h, (d + l, y))
    D = np.array(dist); ok = np.isfinite(D); step = 0.006
    out = []
    for b in range(int(D[ok].max() / step) + 1):
        m = ok & (D >= b * step) & (D < (b + 1) * step)
        if m.sum() >= 4: out.append(P[m].mean(0))
    return [Vector(x) for x in out], [len(x) for x in loops]
sig, sig_loops = centreline(objs['Sigmoid colon'][0], sph_c)   # from its end at the anal sphincter (Z-Anatomy's 'Sigmoid colon' object is the rectum)
desc, desc_loops = centreline(objs['Descending colon'][0], sig[-1])
print('sigmoid boundary loops', sig_loops, 'centre points', len(sig), '; descending', desc_loops, len(desc))
path = sig + desc[1:]

open0 = bvh0.ray_cast(sph_c, sph_ax)[0] or bvh0.find_nearest(sph_c)[0]
RS = sig[-1]   # the top of the rectum: the rectosigmoid junction
dr = RS - open0
# (the rail runs along the rectum's axis, the anal verge -> the rectosigmoid junction: tools/build-body-layers.mjs)
print('opening (standing)', [round(x, 4) for x in open0], 'rectosigmoid junction', [round(x, 4) for x in RS], 'rectum axis %.1f deg from vertical (standing)' % (math.degrees(math.atan2(dr.z, dr.y)) - 90))

# ---------------------------------------------------------------- the pose: one rigid transform per segment
cc = V('Corpus cavernosum of penis'); PIVOT = Vector((0, -0.07, cc[cc[:, 1] < -0.06][:, 2].max()))   # the root of the hanging part, in front of the pubis
def gen_w(p):
    """How much a point hangs with the genitals (the scrotum, the testes, the pendulous penis): below the pubis and in
    front of the perineum; the crura along the pubic arch, the bladder and the prostate stay with the pelvis."""
    return S((PIVOT.z - p.z) / 0.035) * S((-0.005 - p.y) / 0.03)
def Rx(deg): return Matrix.Rotation(math.radians(deg), 4, 'X')
def Ry(deg): return Matrix.Rotation(math.radians(deg), 4, 'Y')
def about(c, R): return Matrix.Translation(c) @ R @ Matrix.Translation(-c)
FOOT_PF = 80.0
HIP_ABDUCTION = 9.0   # deg per side: the thighs spread (paw-641i), the knees ~1.7 x the hip joints' spacing apart
def pose(phi, beta=0.0):
    P = Rx(90 - phi); G = {'root': P, 'gen': P @ about(PIVOT, Rx(phi - 90))}   # the genitals hang as the thighs do
    for s, j in J.items():
        ab = Ry(-j['sx'] * HIP_ABDUCTION)   # abduction: the knee out to its own side (about the hip's front-back axis, standing)
        G['thigh.' + s] = G['root'] @ about(j['hip'], Rx(phi - 90 - beta) @ ab)   # beta: the thigh tilted from vertical, the knee toward the head
        G['shin.' + s] = G['thigh.' + s] @ about(j['knee'], ab.inverted() @ Rx(90 + beta))   # the shin back along the floor, parallel (the abduction undone below the knee)
        G['foot.' + s] = G['shin.' + s] @ about(j['ankle'], Rx(FOOT_PF))
        G['uarm.' + s] = G['root'] @ about(j['shoulder'], Rx(phi - 90))
        axis = (j['uhead'] - j['rhead']).normalized(); sg = 1 if j['sx'] > 0 else -1   # pronation: the palm turns medially
        G['twist.' + s] = G['uarm.' + s] @ about(j['rhead'], Matrix.Rotation(math.radians(sg * 90), 4, axis))
        G['radius.' + s] = G['uarm.' + s] @ about(j['rhead'], Matrix.Rotation(math.radians(sg * 179.5), 4, axis))
        G['hand.' + s] = G['radius.' + s] @ about(j['wrist'], Rx(90))
    return G
def low(G, names, seg):
    return min((G[seg + '.' + n[-1]] @ Vector(v)).z for n in names for v in V(n)[::7])
knee_pts = ['Tibia.l', 'Tibia.r', 'Patella.l', 'Patella.r']
hand_pts = [n for n in objs if segment_of(n).startswith('hand.') and ('metacarpal' in n or 'Proximal phalanx' in n)]
def floor_gap(phi, beta=0.0):
    G = pose(phi, beta)
    kz = min(min((G['shin.' + n[-1]] @ Vector(v)).z for v in V(n)[::5]) if n.startswith('Tibia') else min((G['thigh.' + n[-1]] @ Vector(v)).z for v in V(n)[::5]) for n in knee_pts) - 0.008
    hz = min(min((G['hand.' + n[-1]] @ Vector(v)).z for v in V(n)[::3]) for n in hand_pts) - 0.012
    return hz - kz
# thighs vertical, arms straight: the torso's pitch puts knees and palms on one floor
lo_, hi_ = -20.0, 30.0
for _ in range(40):
    mid = (lo_ + hi_) / 2
    if floor_gap(mid) > 0: hi_ = mid   # the palms above the knees' floor: the head comes down
    else: lo_ = mid
PHI, BETA = (lo_ + hi_) / 2, 0.0
G = pose(PHI, BETA)
print('torso pitch (head up) %.2f deg; floor gap %.4f m' % (PHI, floor_gap(PHI)))

def foot_w(p, j):
    """How much a point of the leg goes with the foot: by its direction from the ankle in the leg's sagittal plane (up
    the shin = 0; forward over the instep, down the sole and back round the heel = 1), so the instep and the heel pad
    follow the tarsals and the calcaneus through the plantarflexion while the Achilles stretches from the calf (a cut by
    height left the instep with the shin: paw-641i)."""
    q = p - j['ankle']; up = (j['knee'] - j['ankle']).normalized(); fw = Vector((0, -1, 0)); fw = (fw - up * fw.dot(up)).normalized()
    a, b = q.dot(fw), q.dot(up)
    if math.hypot(a, b) < 0.008: return 0.5
    phi = math.degrees(abs(math.atan2(a, b)))   # 0 straight up the shin, 90 forward / behind level, 180 straight down
    back = S((phi - 50) / 30)   # behind: round the heel with the calcaneus, the Achilles stretching from the calf
    # in front: below the crease over the talus, and the whole instep ahead of the shin's front, with the tarsals; the
    # shin's front above the crease with the shin
    front = max(S((0.015 - b) / 0.025), S((a - 0.026) / 0.015) * S((0.06 - b) / 0.02))
    t = S((a + 0.01) / 0.02)
    return t * front + (1 - t) * back

def skin_weights(p, cat):
    """-> {segment: weight} for a skin vertex at standing position p of patch category cat (0 torso, 1 leg, 2 arm)."""
    s = 'l' if p.x > 0 else 'r'; j = J[s]; w = {}
    if cat == 3:   # the scrotum and the penis's skin hang with them
        wg = gen_w(p)
        if wg > 0: return {'gen': wg, 'root': 1 - wg}
    if cat != 2:   # the hip: a band under the joint, lower behind (the buttock stays with the pelvis down to its fold)
        q = p - j['hip']; t = max(0.0, min(1.0, (q.y + 0.03) / 0.08)); hi = 0.03 + (-0.06 - 0.03) * t; lo = -0.05 + (-0.15 + 0.05) * t
        wt = S((hi - q.z) / (hi - lo)) * S((abs(p.x) - 0.012) / 0.03)
        if cat == 1: wt = max(wt, S((hi - q.z) / (hi - lo)))
        if wt > 0:
            dk = (j['ankle'] - j['knee']).normalized(); wsh = S(((p - j['knee']).dot(dk) + 0.035) / 0.07)
            wft = foot_w(p, j) if cat == 1 else 0.0
            w['thigh.' + s] = wt * (1 - wsh); w['shin.' + s] = wt * wsh * (1 - wft); w['foot.' + s] = wt * wsh * wft
        w['root'] = 1 - wt
        return w
    da = (j['elbow'] - j['shoulder']).normalized(); q = p - j['shoulder']; pr = q.dot(da)
    wa = S((pr + 0.02) / 0.10)
    df = (j['wrist'] - j['elbow']); lf = df.length; df = df / lf
    t = (p - j['elbow']).dot(df) / lf; wh = S(((p - j['wrist']).dot(df) + 0.012) / 0.035)
    a = 2 * max(0.0, min(1.0, t))
    fore = {'uarm.' + s: 1 - a, 'twist.' + s: a} if a < 1 else {'twist.' + s: 2 - a, 'radius.' + s: a - 1}
    w['root'] = 1 - wa
    for k, x in fore.items(): w[k] = w.get(k, 0) + wa * x * (1 - wh)
    w['hand.' + s] = wa * wh
    return w

def dq(M):
    q = M.to_quaternion(); t = M.translation
    d = Quaternion((0, t.x, t.y, t.z)) @ q
    return q, Quaternion((0.5 * d.w, 0.5 * d.x, 0.5 * d.y, 0.5 * d.z))
DQ = {k: dq(m) for k, m in G.items()}
def skin_pose(me, wfn=None):
    cat = [0.0] * len(me.vertices)
    if wfn is None: me.attributes['cat'].data.foreach_get('value', cat)
    for i, v in enumerate(me.vertices):
        p = v.co.copy(); ws = wfn(p) if wfn else skin_weights(p, round(cat[i]))
        ws = {k: x for k, x in ws.items() if x > 1e-4}
        if len(ws) == 1: v.co = G[next(iter(ws))] @ p; continue
        k0 = max(ws, key=ws.get); r0 = DQ[k0][0]
        br = Quaternion((0, 0, 0, 0)); bd = Quaternion((0, 0, 0, 0)); tot = sum(ws.values())
        for k, x in ws.items():
            r, d = DQ[k]; sg = 1 if r.dot(r0) >= 0 else -1; x = x / tot * sg
            br = Quaternion((br.w + r.w * x, br.x + r.x * x, br.y + r.y * x, br.z + r.z * x)); bd = Quaternion((bd.w + d.w * x, bd.x + d.x * x, bd.y + d.y * x, bd.z + d.z * x))
        n = br.magnitude; br = Quaternion((br.w / n, br.x / n, br.y / n, br.z / n)); bd = Quaternion((bd.w / n, bd.x / n, bd.y / n, bd.z / n))
        t = bd @ br.conjugated(); v.co = br @ p + Vector((2 * t.x, 2 * t.y, 2 * t.z))
skin0 = [v.co.copy() for v in skin.data.vertices]
bone0 = [(v.co.copy(), segment_of(n)) for n, (o, L) in objs.items() if L == 'skeleton' for v in list(o.data.vertices)[::3]]
skin_pose(skin.data)
for name, (o, L) in objs.items():
    if L == 'genitals': skin_pose(o.data, lambda p: (lambda g: {'gen': g, 'root': 1 - g})(gen_w(p)))
    elif L != 'skin': o.data.transform(G[segment_of(name)])
for o, L in objs.values(): o.data.update()

# ---------------------------------------------------------------- the skin against the bones at each joint: how far the
# distance from the skin to the nearest bone changed with the pose (0 where the skin moved with its bones)
from mathutils.kdtree import KDTree
def kd(pts):
    t = KDTree(len(pts))
    for i, p in enumerate(pts): t.insert(p, i)
    t.balance(); return t
kd0, kd1 = kd([p for p, s in bone0]), kd([G[s] @ p for p, s in bone0])
# the front of the ankle goes taut over the tendons when the foot is pointed: the source's ~30 mm of tissue there (as
# stood) would hang under the pointed ankle as a lump (paw-641i), so it is drawn in toward the bones
for s_ in 'lr':
    jA = J[s_]
    for v, p0 in zip(skin.data.vertices, skin0):
        q = p0 - jA['ankle']; up = (jA['knee'] - jA['ankle']).normalized(); a = -q.y; b = q.dot(up)
        g = S((0.075 - q.length) / 0.03) * S((a - 0.005) / 0.02) * S((0.07 - b) / 0.03)
        if g <= 0: continue
        bp, _, d = kd1.find(v.co)
        if d > 0.008: v.co = v.co + (bp - v.co).normalized() * (d - (0.008 + (d - 0.008) * 0.4)) * g
JOINTS = [(s + ' ' + k, J[s][k], r) for s in 'lr' for k, r in (('hip', 0.10), ('knee', 0.08), ('ankle', 0.07), ('shoulder', 0.09), ('elbow', 0.07), ('wrist', 0.06))]
fit_report = {}
for name, c, r in JOINTS:
    ds = []
    for v, p0 in zip(skin.data.vertices, skin0):
        if (p0 - c).length > r: continue
        ds.append(abs(kd1.find(v.co)[2] - kd0.find(p0)[2]))
    ds.sort()
    fit_report[name] = [round(1000 * ds[int(0.95 * (len(ds) - 1))], 1), round(1000 * ds[-1], 1)] if ds else None
print('skin vs bone, change of distance (mm) p95 / max:', fit_report)
if os.environ.get('PW_DEBUG_JOINT'):
    jn = os.environ['PW_DEBUG_JOINT']; c = J['l'][jn]; catv = [0.0] * len(skin.data.vertices); skin.data.attributes['cat'].data.foreach_get('value', catv)
    rows = []
    for i, (v, p0) in enumerate(zip(skin.data.vertices, skin0)):
        if (p0 - c).length > 0.07 or p0.x < 0: continue
        rows.append((kd1.find(v.co)[2] - kd0.find(p0)[2], [round(1000 * x) for x in (p0 - c)], {k: round(x, 2) for k, x in skin_weights(p0, round(catv[i])).items() if x > 0.01}))
    rows.sort(key=lambda r: -r[0])
    for dz in (-0.02, 0.0, 0.02, 0.04):   # standing: the front of the skin vs the front of the bones, across the ankle
        sk = [p.y for p in skin0 if abs(p.z - c.z - dz) < 0.005 and abs(p.x - c.x) < 0.03]; bn = [p.y for p, sg in bone0 if abs(p.z - c.z - dz) < 0.005 and abs(p.x - c.x) < 0.03]
        print('  standing z%+.0f mm: skin front %.1f bone front %.1f (mm from the ankle)' % (dz * 1000, (min(sk) - c.y) * 1000 if sk else 0, (min(bn) - c.y) * 1000 if bn else 0))
    for r in rows[:15]: print('  %+.1f mm' % (1000 * r[0]), r[1], r[2])

# ---------------------------------------------------------------- landmarks in the posed frame
P0 = G['root']
cut_p = P0 @ CUT_P; cut_n = (P0.to_3x3() @ CUT_N).normalized()
sph_cp = P0 @ sph_c; sph_ap = (P0.to_3x3() @ sph_ax).normalized()
bvh = BVHTree.FromObject(skin, bpy.context.evaluated_depsgraph_get())
hit = bvh.ray_cast(sph_cp, sph_ap)[0]
opening = hit if hit else bvh.find_nearest(sph_cp)[0]
path = [P0 @ p for p in path]
print('sphincter centre', [round(x, 4) for x in sph_cp], 'axis', [round(x, 3) for x in sph_ap], 'opening on the skin', [round(x, 4) for x in opening], 'from the ring %.1f mm' % ((opening - sph_cp).length * 1000))

# ---------------------------------------------------------------- the manifest; the posed, cut model as a .blend to sculpt on
EX = lambda p: [round(p[0], 6), round(p[2], 6), round(-p[1], 6)]   # Blender (Z up, -Y toward the head after posing) -> Y up, Z toward the head
EXN = lambda n: [round(n[0], 6), round(n[2], 6), round(-n[1], 6)]
manifest = {'source': 'Z-Anatomy Startup.blend (BodyParts3D-derived)', 'units': 'm', 'up': [0, 1, 0], 'fwd': [0, 0, 1], 'height_m': HEIGHT, 'pitch_deg': PHI, 'hip_abduction_deg': HIP_ABDUCTION, 'layers': {}}
manifest['skipped'] = skipped
manifest['kidneys'] = {k: {'centre': EX(c), 'axes': [EXN(a) for a in ax], 'halfExtents': [round(e, 4) for e in ext]} for k, (c, ax, ext) in ((k, (P0 @ c, [P0.to_3x3() @ a for a in ax], ext)) for k, (c, ax, ext) in kid.items())}
manifest['cut'] = {'point': EX(cut_p), 'normal': EXN(cut_n), 'fade': FADE, 'neck': list(NECK_R)}
manifest['opening'] = EX(opening); manifest['sphincter'] = {'centre': EX(sph_cp), 'axis': EXN(sph_ap)}
manifest['colonPath'] = [EX(p) for p in path]; manifest['rectosigmoid'] = EX(P0 @ RS)
manifest['joints'] = {s: {k: EX(G['root'] @ v) if isinstance(v, Vector) else v for k, v in j.items()} for s, j in J.items()}
seg_of_joint = {'hip': 'root', 'knee': 'thigh', 'ankle': 'shin', 'shoulder': 'root', 'elbow': 'uarm', 'wrist': 'radius'}
manifest['posedJoints'] = {s: {k: EX((G['root'] if g == 'root' else G[g + '.' + s]) @ J[s][k]) for k, g in seg_of_joint.items()} for s in 'lr'}
manifest['skinFit'] = fit_report
kn = [G['thigh.' + s] @ J[s]['knee'] for s in 'lr']
print('knees %.1f mm apart (hip joints %.1f mm): %.2f x' % ((kn[0].x - kn[1].x) * 1000, (J['l']['hip'].x - J['r']['hip'].x) * 1000, (kn[0].x - kn[1].x) / (J['l']['hip'].x - J['r']['hip'].x)))
save_posed(objs, manifest)
write_layers(objs, manifest)
