"""
Dron de alta velocidad "VECTOR-X" — generador paramétrico para Blender (>= 4.5 / 5.x)
====================================================================================

Inspirado en la arquitectura de fuselaje vertical tipo "bala" (PIC-SUN Skyfall /
Red Bull Drone): fuselaje cilíndrico con nariz ojival, 4 brazos en X con
góndolas de motor y propulsores empujadores hacia abajo, y 4 aletas de cola que
sirven de tren de aterrizaje.

Uso
---
  * Desde Blender:  abrir este archivo en el editor de texto y pulsar "Run Script".
  * Sin interfaz:   blender -b -P generar_dron.py -- [--render] [--no-export]
  * Con el módulo bpy de PyPI:  python generar_dron.py [--render] [--no-export]

Salidas (junto a este script):
  stl/            piezas imprimibles, ya orientadas para imprimir y en milímetros
  dron_vector_x.blend   ensamblaje completo (piezas + electrónica de referencia)
  web/            modelos .glb (ensamblado y explosionado) para el visor web
  renders/        imágenes (si se usa --render)

Unidades: 1 unidad de Blender = 1 mm. Eje Z = eje del fuselaje (posición de
despegue: nariz arriba, hélices abajo). Los brazos están en las diagonales.
"""

import bpy
import bmesh
import math
import os
import struct
import sys
from mathutils import Matrix, Vector

# ----------------------------------------------------------------------------
# Parámetros principales (mm)
# ----------------------------------------------------------------------------
SEG = 160                 # resolución angular de las piezas de revolución
R_BODY = 32.0             # radio exterior del fuselaje (Ø64)
WALL = 2.4                # espesor de pared (6 perímetros de 0.4)
R_IN = R_BODY - WALL      # 29.6
LIP_OUT = 29.4            # labio macho de unión (holgura 0.2 con R_IN)
LIP_IN = 26.6
LIP_H = 8.0

Z_TAIL_BOT = 12.0         # fondo del fuselaje
R_TAIL_BOT = 30.5
Z_J1 = 95.0               # cola / buje inferior
Z_ARM = 122.0             # plano medio de los brazos (= partición del buje)
Z_J2 = 141.0              # buje superior / cuerpo superior
Z_J3 = 215.0              # cuerpo superior / nariz
Z_NOSE_CYL = 227.0        # inicio de la ojiva
NOSE_B = 72.0             # semieje vertical de la ojiva
Z_TOP = 291.0             # punta (plana, ventana de cámara)
LENS_HOLE = 8.0           # radio del orificio de lente

ARM_ANGLES = [45.0, 135.0, 225.0, 315.0]
ARM_R = 110.0             # distancia eje-motor (diagonal motor-motor 220 mm)
ARM_W, ARM_H = 24.0, 26.0
ARM_RT, ARM_RB = 8.0, 4.0
CLR = 0.2                 # holgura de encaje
SOCKET_U0 = 28.5          # fondo del alojamiento del brazo
SHOULDER_U0, SHOULDER_U1 = 27.0, 48.0
SH_WALL = 3.5
ARM_BOLTS = [(37.0, 9.0), (44.0, -9.0)]   # (u, v) tornillos M3 verticales

POD_R = 17.0
POD_IN = 14.6
POD_Z0, POD_Z1 = 109.0, 141.0
POD_FLOOR = 4.0
CAP_H = 26.0

FIN_ANGLES = [0.0, 90.0, 180.0, 270.0]
FIN_T = 4.0

M3_CLR, M3_TAP, M3_INSERT = 1.7, 1.25, 2.0      # radios
M25_CLR, M25_TAP = 1.4, 1.05
M2_CLR, M2_TAP = 1.1, 0.85

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() and os.path.exists(__file__) \
    else (os.path.dirname(bpy.data.filepath) or os.getcwd())
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]

SOLVER = "MANIFOLD" if "MANIFOLD" in [e.identifier for e in
                                     bpy.types.BooleanModifier.bl_rna.properties["solver"].enum_items] else "EXACT"


# ----------------------------------------------------------------------------
# Utilidades de malla
# ----------------------------------------------------------------------------
def coll(name, parent=None):
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if c.name not in (parent or bpy.context.scene.collection).children:
        (parent or bpy.context.scene.collection).children.link(c)
    return c


CUTTERS = None


def new_obj(name, verts, faces, collection=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.validate()
    me.update()
    ob = bpy.data.objects.new(name, me)
    (collection or CUTTERS).objects.link(ob)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    return ob


def dedupe(poly, tol=1e-4):
    out = []
    for p in poly:
        if not out or (abs(p[0] - out[-1][0]) > tol or abs(p[1] - out[-1][1]) > tol):
            out.append(p)
    if len(out) > 1 and abs(out[0][0] - out[-1][0]) < tol and abs(out[0][1] - out[-1][1]) < tol:
        out.pop()
    return out


def lathe(name, poly, segs=SEG, center=(0.0, 0.0), collection=None):
    """Sólido de revolución a partir de un polígono cerrado (r, z)."""
    poly = dedupe(poly)
    cx, cy = center
    verts, rings = [], []
    for r, z in poly:
        if r < 1e-6:
            rings.append([len(verts)])
            verts.append((cx, cy, z))
        else:
            ring = []
            for k in range(segs):
                a = 2 * math.pi * k / segs
                ring.append(len(verts))
                verts.append((cx + r * math.cos(a), cy + r * math.sin(a), z))
            rings.append(ring)
    faces = []
    n = len(rings)
    for i in range(n):
        A, B = rings[i], rings[(i + 1) % n]
        if len(A) == 1 and len(B) == 1:
            continue
        for k in range(segs):
            k2 = (k + 1) % segs
            if len(A) == 1:
                faces.append((A[0], B[k2], B[k]))
            elif len(B) == 1:
                faces.append((A[k], A[k2], B[0]))
            else:
                faces.append((A[k], A[k2], B[k2], B[k]))
    return new_obj(name, verts, faces, collection)


def loft(name, sections, mat=Matrix(), collection=None):
    """sections: lista de (perfil2d, z). Todos los perfiles con igual nº de puntos.
    Se extruye en el eje Z local y se transforma con 'mat'."""
    n = len(sections[0][0])
    verts, faces = [], []
    for prof, z in sections:
        for x, y in prof:
            verts.append(mat @ Vector((x, y, z)))
    m = len(sections)
    faces.append(tuple(range(n))[::-1])
    faces.append(tuple(range((m - 1) * n, m * n)))
    for s in range(m - 1):
        for i in range(n):
            j = (i + 1) % n
            faces.append((s * n + i, s * n + j, (s + 1) * n + j, (s + 1) * n + i))
    return new_obj(name, verts, faces, collection)


def extrude(name, prof, z0, z1, mat=Matrix(), collection=None):
    return loft(name, [(prof, z0), (prof, z1)], mat, collection)


def circle(r, n=48, cx=0.0, cy=0.0):
    return [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def rrect(w, h, rt, rb=None, n=10, cx=0.0, cy=0.0):
    """Rectángulo redondeado (ancho w en x, alto h en y); radios arriba rt, abajo rb."""
    rb = rt if rb is None else rb
    pts = []
    corners = [(w / 2 - rt, h / 2 - rt, rt, 0), (-w / 2 + rt, h / 2 - rt, rt, 90),
               (-w / 2 + rb, -h / 2 + rb, rb, 180), (w / 2 - rb, -h / 2 + rb, rb, 270)]
    for x0, y0, r, a0 in corners:
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cx + x0 + r * math.cos(a), cy + y0 + r * math.sin(a)))
    return dedupe(pts)


def hexagon(af):  # entre caras
    r = af / math.sqrt(3)
    return [(r * math.cos(math.radians(30 + 60 * i)), r * math.sin(math.radians(30 + 60 * i))) for i in range(6)]


def rounded_end_sections(prof_fn, z0, z1, rad, steps=6):
    """Secciones de un prisma con el extremo z1 redondeado (radio rad)."""
    secs = [(prof_fn(0.0), z0), (prof_fn(0.0), z1 - rad)]
    for i in range(1, steps + 1):
        t = (math.pi / 2) * i / steps
        secs.append((prof_fn(rad * (1 - math.cos(t))), z1 - rad + rad * math.sin(t)))
    return secs


# Matrices de marco
def M_along_x():   # perfil (x->Y, y->Z), extrusión z->X
    return Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def M_along_y():   # perfil (x->X, y->Z), extrusión z->Y
    return Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def Rz(deg):
    return Matrix.Rotation(math.radians(deg), 4, "Z")


def T(x, y, z):
    return Matrix.Translation((x, y, z))


def cyl_z(name, r, z0, z1, x=0.0, y=0.0, n=48):
    return extrude(name, circle(r, n, x, y), z0, z1)


def cyl_dir(name, r, start, direction, length, n=48):
    d = Vector(direction).normalized()
    rot = d.to_track_quat("Z", "Y").to_matrix().to_4x4()
    return extrude(name, circle(r, n), 0.0, length, T(*start) @ rot)


def apply_mods(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)
    me.name = ob.name


def boolean(ob, others, op="DIFFERENCE"):
    if not isinstance(others, (list, tuple)):
        others = [others]
    for c in others:
        m = ob.modifiers.new("B", "BOOLEAN")
        m.operation = op
        m.object = c
        m.solver = SOLVER
        apply_mods(ob)
        bpy.data.objects.remove(c, do_unlink=True)
    return ob


def join(target, others):
    """Une mallas sin booleana (solo para modelos de referencia, no imprimibles)."""
    bm = bmesh.new()
    bm.from_mesh(target.data)
    for o in others:
        tmp = o.data.copy()
        tmp.transform(o.matrix_world)
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
        bpy.data.objects.remove(o, do_unlink=True)
    bm.to_mesh(target.data)
    bm.free()
    return target


def bevel_all(ob, offset, segments=3):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=offset, segments=segments, profile=0.5,
                    affect="EDGES", clamp_overlap=True)
    bm.to_mesh(ob.data)
    bm.free()


def finish(ob, collection, material=None, smooth_deg=32.0):
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    collection.objects.link(ob)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    thr = math.radians(smooth_deg)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        e.smooth = not (len(e.link_faces) == 2 and e.calc_face_angle(0) > thr)
    bm.to_mesh(ob.data)
    bm.free()
    if material:
        ob.data.materials.clear()
        ob.data.materials.append(material)
    return ob


def mesh_report(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    nm = sum(1 for e in bm.edges if not e.is_manifold)
    vol = abs(bm.calc_volume(signed=True))
    tris = sum(len(f.verts) - 2 for f in bm.faces)
    bm.free()
    return nm, vol, tris


# ----------------------------------------------------------------------------
# Perfil del fuselaje
# ----------------------------------------------------------------------------
def R_tail(z):
    t = min(max((z - Z_TAIL_BOT) / (40.0 - Z_TAIL_BOT), 0.0), 1.0)
    return R_TAIL_BOT + (R_BODY - R_TAIL_BOT) * math.sin(t * math.pi / 2)


def nose_outer_pts():
    pts = [(R_BODY, Z_J3), (R_BODY, Z_NOSE_CYL)]
    t_top = math.asin((Z_TOP - Z_NOSE_CYL) / NOSE_B)
    N = 70
    for i in range(1, N + 1):
        t = t_top * i / N
        pts.append((R_BODY * math.cos(t), Z_NOSE_CYL + NOSE_B * math.sin(t)))
    return pts, t_top


def nose_inner_pts(t_top):
    """Superficie interior: desplazamiento normal de la elipse + cono a 45° bajo la punta
    (para imprimir la nariz de pie sin soportes)."""
    z_a = Z_TOP - 2.5
    cone = lambda r: z_a - (r - LENS_HOLE)
    pts = [(R_IN, Z_NOSE_CYL)]
    N = 200
    prev = pts[0]
    for i in range(1, N + 1):
        t = t_top * i / N
        x, y = R_BODY * math.cos(t), NOSE_B * math.sin(t)
        nx, ny = x / R_BODY ** 2, y / NOSE_B ** 2
        L = math.hypot(nx, ny)
        p = (x - WALL * nx / L, Z_NOSE_CYL + y - WALL * ny / L)
        if p[1] >= cone(p[0]):
            # intersección lineal entre prev y p
            f0 = prev[1] - cone(prev[0])
            f1 = p[1] - cone(p[0])
            s = f0 / (f0 - f1)
            X = (prev[0] + s * (p[0] - prev[0]), prev[1] + s * (p[1] - prev[1]))
            pts.append(X)
            break
        pts.append(p)
        prev = p
    pts.append((LENS_HOLE, z_a))
    return pts  # de abajo hacia arriba


# ----------------------------------------------------------------------------
# Piezas imprimibles
# ----------------------------------------------------------------------------
def radial_holes(prefix, z, angles, r, r0=22.0, r1=36.0):
    out = []
    for a in angles:
        d = (math.cos(math.radians(a)), math.sin(math.radians(a)), 0)
        out.append(cyl_dir(prefix, r, (d[0] * r0, d[1] * r0, z), d, r1 - r0, 24))
    return out


J1_ANG, J2_ANG, J3_ANG = [0, 120, 240], [0, 120, 240], [30, 150, 270]
CAP_ANG = [45, 165, 285]
Z_J1S, Z_J2S, Z_J3S, Z_CAPS = Z_J1 + 4, Z_J2 + 4, Z_J3 + 4, 18.0


def make_tail():
    poly = []
    for i in range(0, 29):
        z = Z_TAIL_BOT + (40 - Z_TAIL_BOT) * i / 28
        poly.append((R_tail(z), z))
    poly += [(R_BODY, Z_J1 - 1.5), (R_BODY - 1.5, Z_J1), (LIP_OUT, Z_J1), (LIP_OUT, Z_J1 + LIP_H),
             (LIP_IN, Z_J1 + LIP_H), (LIP_IN, Z_J1), (R_IN, Z_J1 - 3.0), (R_IN, 40.0)]
    for i in range(1, 11):
        z = 40 - 10 * i / 10
        poly.append((R_tail(z) - WALL, z))
    r30 = R_tail(30.0) - WALL
    poly += [(R_TAIL_BOT - WALL, 30.0 - (r30 - (R_TAIL_BOT - WALL))), (R_TAIL_BOT - WALL, Z_TAIL_BOT)]
    ob = lathe("cola", poly)

    fins = []
    for a in FIN_ANGLES:
        prof = [(30.0, 72.0), (47.0, 26.0), (47.0, 0.0), (33.0, 0.0), (31.0, 4.0), (31.0, 12.0), (30.0, 12.0)]
        f = extrude("aleta", prof, -FIN_T / 2, FIN_T / 2, Rz(a) @ M_along_y() @ Matrix.Scale(1, 4))
        # M_along_y: perfil x->X (radial), y->Z, extrusión ->Y (espesor)
        bevel_all(f, 1.3, 3)
        fins.append(f)
    boolean(ob, fins, "UNION")
    boolean(ob, radial_holes("h", Z_J1S, J1_ANG, M3_TAP, 24.0, 30.0))
    boolean(ob, radial_holes("h", Z_CAPS, CAP_ANG, M3_CLR, 26.0, 34.0))
    return ob


def make_tail_cap():
    rp = R_TAIL_BOT - WALL - CLR  # 27.9
    poly = [(0.0, 9.0), (R_TAIL_BOT - 1.0, 9.0), (R_TAIL_BOT, 10.0), (R_TAIL_BOT, Z_TAIL_BOT),
            (rp, Z_TAIL_BOT), (rp, 24.0), (rp - 3.5, 24.0), (rp - 3.5, Z_TAIL_BOT), (0.0, Z_TAIL_BOT)]
    ob = lathe("tapa_cola", poly)
    cut = [extrude("w", rrect(8.5, 6.5, 1.2), 7.0, 14.0)]                     # ventana sensor ToF
    cut += radial_holes("h", Z_CAPS, CAP_ANG, M3_TAP, 20.0, 29.0)
    cut += [extrude("s", rrect(16.0, 3.0, 1.4, cy=-18.0), 7.0, 14.0)]          # ranura cinta extracción
    boolean(ob, cut)
    return ob


def arm_frame(a):
    return Rz(a) @ M_along_x()


def shoulder_block(a):
    def prof(d):
        w = ARM_W + 2 * CLR + 2 * SH_WALL - 2 * d
        h = ARM_H + 2 * CLR + 2 * SH_WALL - 2 * d
        return rrect(w, h, max(ARM_RT + SH_WALL - d, 0.5), max(ARM_RB + SH_WALL - d, 0.5), 10, 0.0, Z_ARM)
    return loft("hombro", rounded_end_sections(prof, SHOULDER_U0, SHOULDER_U1, 3.5, 6), arm_frame(a))


def arm_cutters(a, socket=True):
    cs = []
    if socket:
        cs.append(extrude("socket", rrect(ARM_W + 2 * CLR, ARM_H + 2 * CLR, ARM_RT + CLR, ARM_RB + CLR, 10, 0, Z_ARM),
                          SOCKET_U0, 70.0, arm_frame(a)))
        cs.append(extrude("cable", rrect(13.0, 11.0, 2.0, 2.0, 4, 0, Z_ARM), 22.0, 30.0, arm_frame(a)))
    for u, v in ARM_BOLTS:
        p = Rz(a) @ Vector((u, v, 0))
        cs.append(cyl_z("perno", M3_CLR, Z_ARM - 30, Z_ARM + 30, p.x, p.y, 32))
    return cs


def make_hub(lower=True):
    if lower:
        poly = [(R_BODY, Z_J1), (R_BODY, Z_ARM), (R_IN, Z_ARM), (R_IN, 112.0), (LIP_IN, 109.0),
                (LIP_IN, 106.0), (R_IN, 106.0), (R_IN, Z_J1)]
    else:
        poly = [(R_BODY, Z_ARM), (R_BODY, Z_J2), (LIP_OUT, Z_J2), (LIP_OUT, Z_J2 + LIP_H),
                (LIP_IN, Z_J2 + LIP_H), (LIP_IN, Z_J2), (R_IN, Z_J2 - 3.0), (R_IN, Z_ARM)]
    ob = lathe("buje_inferior" if lower else "buje_superior", poly)
    boolean(ob, [shoulder_block(a) for a in ARM_ANGLES], "UNION")
    # caja que elimina la otra mitad
    if lower:
        half = extrude("mitad", [(-300, -300), (300, -300), (300, 300), (-300, 300)], Z_ARM, Z_ARM + 100)
    else:
        half = extrude("mitad", [(-300, -300), (300, -300), (300, 300), (-300, 300)], Z_ARM - 100, Z_ARM)
    boolean(ob, half)
    cuts = []
    for a in ARM_ANGLES:
        cuts += arm_cutters(a)
    # ranura USB-C de la controladora (lado +X, entre brazos)
    cuts.append(extrude("usb", rrect(11.5, 6.5, 2.0, 2.0, 6, 0, 120.5), 24.0, 36.0, M_along_x()))
    if lower:
        cuts += radial_holes("h", Z_J1S, J1_ANG, M3_CLR, 28.0, 34.0)
        for k in range(4):  # tornillos de la placa de la pila (M2.5 auto-roscante, desde abajo)
            a = math.radians(90 * k)
            cuts.append(cyl_z("h", M25_TAP, 100.0, 111.0, 28.1 * math.cos(a), 28.1 * math.sin(a), 20))
    else:
        cuts += radial_holes("h", Z_J2S, J2_ANG, M3_TAP, 24.0, 30.0)
    boolean(ob, cuts)
    return ob


def make_arm():
    """Brazo + góndola de motor (marco local: u = X radial, v = Y, z absoluto)."""
    M = M_along_x()
    beam = extrude("brazo", rrect(ARM_W, ARM_H, ARM_RT, ARM_RB, 10, 0, Z_ARM), SOCKET_U0 + CLR, ARM_R, M)
    # góndola
    f = 2.0
    pod_poly = [(4.5, POD_Z0), (POD_R - f, POD_Z0)]
    for i in range(1, 7):
        t = (math.pi / 2) * i / 6
        pod_poly.append((POD_R - f + f * math.sin(t), POD_Z0 + f - f * math.cos(t)))
    pod_poly += [(POD_R, POD_Z1 - 0.6), (POD_R - 0.6, POD_Z1), (POD_IN, POD_Z1),
                 (POD_IN, POD_Z0 + POD_FLOOR), (4.5, POD_Z0 + POD_FLOOR)]
    pod = lathe("gondola", pod_poly, 128, (ARM_R, 0.0))
    boolean(beam, pod, "UNION")
    cuts = [cyl_z("interior", POD_IN, POD_Z0 + POD_FLOOR, POD_Z1 + 5, ARM_R, 0.0, 128)]
    # canal de cables (rombo, autoportante)
    dia = [(0, Z_ARM + 7.0), (-7.0, Z_ARM), (0, Z_ARM - 7.0), (7.0, Z_ARM)]
    cuts.append(extrude("canal", dia, 20.0, ARM_R - 4.0, M))
    # pernos de fijación al buje
    for u, v in ARM_BOLTS:
        cuts.append(cyl_z("perno", M3_CLR, Z_ARM - 30, Z_ARM + 30, u, v, 32))
    # montaje motor 16x16 M3 + paso de cables
    for k in range(4):
        a = math.radians(45 + 90 * k)
        cuts.append(cyl_z("m3", M3_CLR, POD_Z0 - 1, POD_Z0 + POD_FLOOR + 1,
                          ARM_R + 11.314 * math.cos(a), 11.314 * math.sin(a), 24))
    cuts.append(cyl_z("cables", 3.4, POD_Z0 - 1, POD_Z0 + POD_FLOOR + 1, ARM_R - 11.0, 0.0, 24))
    # ranura decorativa (línea gris de las referencias) en ambos costados
    for s in (1, -1):
        cuts.append(extrude("ranura", [(-0.6, -0.6), (0.6, -0.6), (0.6, 0.6), (-0.6, 0.6)],
                            SHOULDER_U1 + 1.0, ARM_R - POD_R + 1.5,
                            M @ T(s * ARM_W / 2, Z_ARM - 3.0, 0)))
    boolean(beam, cuts)
    return beam


def make_pod_cap():
    poly = [(0.0, POD_Z1), (12.6, POD_Z1), (12.6, POD_Z1 - 5.0), (POD_IN - 0.25, POD_Z1 - 5.0),
            (POD_IN - 0.25, POD_Z1), (POD_R - 0.6, POD_Z1)]
    N = 40
    for i in range(0, N + 1):
        t = (math.pi / 2) * i / N
        # súper-elipse: perfil de "bala" como en las referencias
        c, s = math.cos(t), math.sin(t)
        poly.append(((POD_R - 0.6) * c ** 0.8 if c > 0 else 0.0, POD_Z1 + CAP_H * s))
    poly.append((0.0, POD_Z1 + CAP_H))
    return lathe("cupula_motor", poly, 128, (ARM_R, 0.0))


def make_upper():
    poly = [(R_BODY, Z_J2), (R_BODY, Z_J3), (LIP_OUT, Z_J3), (LIP_OUT, Z_J3 + LIP_H), (23.8, Z_J3 + LIP_H),
            (23.8, Z_J3 + 6.0), (LIP_IN, Z_J3 + 3.2), (LIP_IN, Z_J3), (R_IN, Z_J3 - 3.0),
            (R_IN, 178.0), (19.5, 178.0), (19.5, 174.0), (R_IN, 174.0 - (R_IN - 19.5)), (R_IN, Z_J2)]
    ob = lathe("cuerpo_superior", poly)
    cuts = radial_holes("h", Z_J2S, J2_ANG, M3_CLR, 28.0, 34.0)
    cuts += radial_holes("h", Z_J3S, J3_ANG, M3_TAP, 24.0, 30.0)
    for a in [0, 120, 240]:   # tornillos de la base de cámara (M2.5)
        r = math.radians(a)
        cuts.append(cyl_z("h", M25_TAP, Z_J3 + 1.0, Z_J3 + LIP_H + 1, 26.8 * math.cos(r), 26.8 * math.sin(r), 20))
    for a in [30, 150, 270]:  # tornillos de la placa de aviónica (M2)
        r = math.radians(a)
        cuts.append(cyl_z("h", M2_TAP, 172.0, 179.0, 21.4 * math.cos(r), 21.4 * math.sin(r), 16))
    # ventana de LED de estado (lado dorsal +Y)
    cuts.append(extrude("led", rrect(7.0, 18.0, 3.0, 3.0, 8, 0, 192.0), R_BODY - 1.2, R_BODY + 3, M_along_y()))
    for z in (186.5, 192.0, 197.5):
        cuts.append(cyl_dir("led", 1.6, (0, 25.0, z), (0, 1, 0), 10.0, 24))
    boolean(ob, cuts)
    return ob


MAST_Z, MAST_LEN = 248.0, 44.0
MAST_DIR = Vector((0, math.cos(math.radians(45)), math.sin(math.radians(45))))


def make_nose():
    outer, t_top = nose_outer_pts()
    inner = nose_inner_pts(t_top)
    poly = outer[:-1] + [(outer[-1][0] - 0.8, Z_TOP), (LENS_HOLE + 0.8, Z_TOP), (LENS_HOLE, Z_TOP - 0.8)]
    poly += list(reversed(inner)) + [(R_IN, Z_J3)]
    ob = lathe("nariz", poly)
    # mástil de antena a 45° (imprimible sin soportes)
    start = Vector((0, 27.0, MAST_Z))

    def mprof(d):
        return circle(max(3.5 - d, 0.3), 32)
    rot = MAST_DIR.to_track_quat("Z", "Y").to_matrix().to_4x4()
    mast = loft("mastil", rounded_end_sections(mprof, 0.0, MAST_LEN, 1.5, 4), T(*start) @ rot)
    boolean(ob, mast, "UNION")
    cuts = [cyl_dir("bore", 1.7, tuple(start - MAST_DIR * 6), MAST_DIR, MAST_LEN + 8, 24)]
    cuts += radial_holes("h", Z_J3S, J3_ANG, M3_CLR, 28.0, 34.0)
    boolean(ob, cuts)
    return ob


def make_stack_plate():
    z0, z1 = Z_J1 + LIP_H, Z_J1 + LIP_H + 3.0   # 103..106
    ob = lathe("placa_pila", [(10.0, z0), (29.2, z0), (29.2, z1), (10.0, z1)])
    bosses = [cyl_z("boss", 4.2, z1 - 0.5, z1 + 4.0, 15.25 * sx, 15.25 * sy, 40) for sx in (1, -1) for sy in (1, -1)]
    boolean(ob, bosses, "UNION")
    cuts = [cyl_z("ins", M3_INSERT, z0 - 1, z1 + 5, 15.25 * sx, 15.25 * sy, 32) for sx in (1, -1) for sy in (1, -1)]
    for k in range(4):
        a = math.radians(90 * k)
        cuts.append(cyl_z("h", M25_CLR, z0 - 1, z1 + 1, 28.1 * math.cos(a), 28.1 * math.sin(a), 20))
    for a in ARM_ANGLES:  # rebajes para los hombros del buje
        cuts.append(extrude("rebaje", rrect(ARM_W + 2 * CLR + 2 * SH_WALL + 0.8, 20.0, 1.0, 1.0, 4, 0, z1),
                            SHOULDER_U0 - 0.4, 40.0, arm_frame(a)))
    boolean(ob, cuts)
    return ob


def make_avionics_plate():
    z0, z1 = 178.0, 180.5
    ob = lathe("placa_avionica", [(7.0, z0), (23.2, z0), (23.2, z1), (7.0, z1)])
    bosses = [cyl_z("boss", 2.6, z1 - 0.5, z1 + 3.0, 10 * sx, 10 * sy, 32) for sx in (1, -1) for sy in (1, -1)]
    boolean(ob, bosses, "UNION")
    cuts = [cyl_z("m2", M2_TAP, z0 - 1, z1 + 4, 10 * sx, 10 * sy, 20) for sx in (1, -1) for sy in (1, -1)]
    for a in [30, 150, 270]:
        r = math.radians(a)
        cuts.append(cyl_z("h", M2_CLR, z0 - 1, z1 + 1, 21.4 * math.cos(r), 21.4 * math.sin(r), 16))
    for a in [90, 210, 330]:
        r = math.radians(a)
        cuts.append(extrude("slot", rrect(9.0, 4.0, 1.8, 1.8, 6), z0 - 1, z1 + 1,
                            T(17.0 * math.cos(r), 17.0 * math.sin(r), 0) @ Rz(a + 90)))
    boolean(ob, cuts)
    return ob


CAM_Z0, CAM_Z1 = 262.0, 282.0     # cuerpo de la cámara 19x19 mm


def make_camera_mount():
    z0, z1 = Z_J3 + LIP_H, Z_J3 + LIP_H + 3.0   # 223..226
    ob = lathe("soporte_camara", [(0.0, z0), (29.0, z0), (29.0, z1), (0.0, z1)])
    parts = []
    for s in (1, -1):
        x0 = s * (9.6 + 1.5)
        parts.append(extrude("placa", [(x0 - 1.5, -8), (x0 + 1.5, -8), (x0 + 1.5, 8), (x0 - 1.5, 8)],
                             z1 - 0.5, 277.0))
        # cartelas de refuerzo
        g = [(0.0, 0.0), (9.0, 0.0), (0.0, 16.0)]
        parts.append(extrude("cartela", [(p[0] * s + x0 + s * 1.4, p[1] + z1 - 0.5) for p in g][::s],
                             -1.5, 1.5, M_along_y()))
    boolean(ob, parts, "UNION")
    # colisos verticales M2 (ajuste de altura de la cámara)
    cuts = [extrude("coliso", rrect(2.3, 9.0, 1.12, 1.12, 6, 0.0, 271.0), 6.0, 16.0, M_along_x()),
            extrude("coliso", rrect(2.3, 9.0, 1.12, 1.12, 6, 0.0, 271.0), -16.0, -6.0, M_along_x())]
    for a in [0, 120, 240]:
        r = math.radians(a)
        cuts.append(cyl_z("h", M25_CLR, z0 - 1, z1 + 1, 26.8 * math.cos(r), 26.8 * math.sin(r), 20))
    cuts.append(cyl_z("coax", 2.6, z0 - 1, z1 + 1, 0.0, 20.5, 20))
    cuts.append(extrude("cables", rrect(10.0, 5.0, 2.0, 2.0, 6, 0, -19.0), z0 - 1, z1 + 1))
    cuts.append(extrude("cables", rrect(5.0, 10.0, 2.0, 2.0, 6, 19.0, 0), z0 - 1, z1 + 1))
    boolean(ob, cuts)
    return ob


# ----------------------------------------------------------------------------
# Electrónica y hardware de referencia (no imprimible)
# ----------------------------------------------------------------------------
def box(name, sx, sy, sz, x=0, y=0, z=0, r=0.6):
    return extrude(name, rrect(sx, sy, min(r, sx / 2 - 0.01, sy / 2 - 0.01), None, 4, x, y), z, z + sz)


def propeller(name, ccw=False, nblades=3, R=63.5, pitch=127.0):
    parts = []
    hub = lathe(name + "_cubo", [(2.6, -3.5), (6.5, -3.5), (6.5, 3.5), (2.6, 3.5)], 48)
    parts.append(hub)
    NS, NA = 26, 18
    for b in range(nblades):
        secs = []
        for i in range(NS):
            t = i / (NS - 1)
            r = 5.5 + (R - 5.5) * t
            chord = (7.0 + 10.5 * math.sin(math.pi * min(1.0, 0.25 + 0.9 * t)) ** 0.7) * math.sqrt(max(1 - t ** 6, 0.04))
            th = max(0.12 * chord * (1 - 0.55 * t), 0.45)
            phi = math.atan(pitch / (2 * math.pi * r))
            sweep = 4.0 * t * t
            sec = []
            for k in range(NA):
                s = 2 * math.pi * k / NA
                x = 0.5 * chord * math.cos(s)
                y = 0.5 * th * math.sin(s) + 0.04 * chord * (1 - (2 * x / chord) ** 2)
                X = x * math.cos(phi) - y * math.sin(phi) + sweep
                Y = x * math.sin(phi) + y * math.cos(phi)
                sec.append((X if not ccw else -X, Y))
            secs.append((sec, r))
        # extrusión a lo largo del radio: perfil (tangencial, axial) -> marco del aspa
        M = Rz(120 * b) @ Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
        parts.append(loft(name + "_aspa", secs, M))
    return join(parts[0], parts[1:])


def motor_2207(name):
    """Motor 2207 con campana hacia abajo; z=0 = cara de montaje."""
    base = lathe(name, [(4.0, 0.0), (13.6, 0.0), (13.6, -3.0), (4.0, -3.0)], 64)
    bell = lathe(name + "_campana", [(3.0, -3.2), (13.9, -3.2), (13.9, -15.5), (13.0, -17.0),
                                     (5.0, -17.0), (3.0, -17.0)], 64)
    vents = [extrude("v", rrect(3.6, 7.0, 1.2, 1.2, 4, 0, -9.5), 10.0, 16.0, Rz(60 * k + 30) @ M_along_x())
             for k in range(6)]
    boolean(bell, vents)
    shaft = cyl_z("eje", 2.5, -30.0, -3.0, 0, 0, 24)
    nut = extrude("tuerca", hexagon(8.0), -31.5, -28.0)
    return join(base, [bell, shaft, nut])


def build_reference(C, mats):
    refs = []

    def add(ob, mat, name=None):
        if name:
            ob.name = name
        finish(ob, C, mats[mat], 40)
        refs.append(ob)
        return ob

    for i, a in enumerate(ARM_ANGLES):
        x, y = ARM_R * math.cos(math.radians(a)), ARM_R * math.sin(math.radians(a))
        m = motor_2207("motor_%d" % (i + 1))
        m.data.transform(T(x, y, POD_Z0))
        add(m, "motor", "Motor 2207 #%d" % (i + 1))
        p = propeller("helice_%d" % (i + 1), ccw=(i % 2 == 1))
        p.data.transform(T(x, y, POD_Z0 - 25.0) @ Rz(a * 1.7))
        add(p, "prop", "Helice 5x5x3 #%d" % (i + 1))
        for k in range(4):  # tornillos motor
            aa = math.radians(45 + 90 * k)
            s = cyl_z("t", 2.7, POD_Z0 + POD_FLOOR, POD_Z0 + POD_FLOOR + 2.0,
                      x + 11.314 * math.cos(aa + math.radians(a)), y + 11.314 * math.sin(aa + math.radians(a)), 16)
            add(s, "metal")
        for u, v in ARM_BOLTS:  # pernos del brazo
            q = Rz(a) @ Vector((u, v, 0))
            h = Z_ARM + ARM_H / 2 + CLR + SH_WALL
            add(cyl_z("perno", 2.75, h, h + 2.5, q.x, q.y, 24), "metal")
            zb = 2 * Z_ARM - h
            add(extrude("tuerca", hexagon(5.5), zb - 2.4, zb, T(q.x, q.y, 0)), "metal")

    # Pila FC + ESC 30.5x30.5
    add(box("esc", 36, 36, 1.6, z=110.0, r=2), "pcb", "ESC 4en1 30x30 (55A, 6S)")
    for sx in (1, -1):
        for sy in (1, -1):
            add(box("mos", 5, 6, 1.2, 8 * sx, 9 * sy, 111.6, 0.3), "chip")
    add(box("fc", 36, 36, 1.6, z=118.5, r=2), "pcb2", "Controladora de vuelo F7 30x30")
    add(box("mcu", 10, 10, 1.4, 0, 0, 120.1, 0.4), "chip", "MCU STM32F7")
    add(box("imu", 3, 3, 1.0, -7, 6, 120.1, 0.2), "chip", "IMU ICM-42688-P")
    add(box("baro", 2.5, 2.5, 0.9, 7, -7, 120.1, 0.2), "chip", "Barometro DPS310")
    add(box("usb", 9.0, 7.4, 3.2, 14.2, 0, 115.0, 1.4), "metal", "USB-C FC")
    for sx in (1, -1):
        for sy in (1, -1):
            add(cyl_z("separador", 2.6, 110.0, 126.0, 15.25 * sx, 15.25 * sy, 16), "rubber")
    add(cyl_z("cap", 5.0, 88.0, 101.0, 0, -16.0 + 30, 32), "cap", "Condensador 1000uF 35V")

    # Batería 6S 1300-1500 mAh
    add(box("bat", 35, 37, 75, z=24.5, r=3), "battery", "Bateria LiPo 6S 1300mAh")
    add(box("xt60", 16, 8.2, 15, 0, 0, 100.0, 1.0), "xt60", "Conector XT60")

    # Sensor ToF / flujo óptico mirando hacia abajo (tapa de cola)
    add(box("tof", 10, 14, 3.0, 0, 0, 12.2, 1.0), "pcb", "Sensor ToF VL53L1X")

    # Aviónica superior: VTX digital 20x20 + receptor + buzzer
    add(box("vtx", 29, 29, 7.5, z=184.0, r=2), "vtx", "VTX digital 20x20")
    add(box("rx", 11, 19, 3.2, 0, 0, 174.5, 0.8), "pcb", "Receptor ExpressLRS")
    add(cyl_z("buzzer", 6.0, 167.5, 173.3, 0, 0, 32), "chip", "Buzzer 5V")

    # GPS + cámara (soporte de nariz)
    add(box("gps", 15, 15, 4.5, 0, 0, 226.2, 1.0), "pcb", "GPS M10 + brujula")
    add(box("gps_ant", 12, 12, 4.0, 0, 0, 230.7, 0.5), "ceramic")
    cam = box("cam", 19, 19, CAM_Z1 - CAM_Z0, z=CAM_Z0, r=1.5)
    lens = lathe("lente", [(0, CAM_Z1), (7.0, CAM_Z1), (7.0, 287.5), (6.4, 288.6), (0, 288.6)], 64)
    add(join(cam, [lens]), "cam", "Camara FPV micro 19x19")
    add(lathe("vidrio", [(0, 288.6), (5.0, 288.6), (0, 289.4)], 64), "glass", "Lente")
    # LEDs de estado (amarillo, como en la referencia)
    for z in (186.5, 192.0, 197.5):
        add(cyl_dir("led", 1.5, (0, 27.0, z), (0, 1, 0), 4.4, 24), "led")
    # antena del VTX en la punta del mástil
    tip = Vector((0, 27.0, MAST_Z)) + MAST_DIR * (MAST_LEN + 0.5)
    ant = cyl_dir("antena", 1.0, tuple(tip), MAST_DIR, 6.0, 16)
    head = lathe("antena_cabeza", [(0, 0), (4.5, 1.0), (4.5, 4.0), (0, 6.5)], 32)
    head.data.transform(T(*(tip + MAST_DIR * 6.0)) @ MAST_DIR.to_track_quat("Z", "Y").to_matrix().to_4x4())
    add(join(ant, [head]), "antenna", "Antena VTX")
    return refs


# ----------------------------------------------------------------------------
# Materiales, escena y exportación
# ----------------------------------------------------------------------------
def material(name, rgb, rough=0.5, metal=0.0, emit=None, alpha=1.0, trans=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*rgb, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if trans:
        b.inputs["Transmission Weight"].default_value = trans
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1.0)
        b.inputs["Emission Strength"].default_value = 6.0
    m.diffuse_color = (*rgb, 1.0)
    return m


def make_materials():
    return {
        "body": material("PETG-CF negro mate", (0.018, 0.018, 0.02), 0.62),
        "hub": material("PETG gris grafito", (0.09, 0.09, 0.095), 0.55),
        "accent": material("Acento", (0.018, 0.018, 0.02), 0.62),
        "motor": material("Motor anodizado", (0.32, 0.32, 0.34), 0.32, 0.9),
        "prop": material("Helice policarbonato", (0.05, 0.05, 0.055), 0.35),
        "metal": material("Acero", (0.6, 0.6, 0.62), 0.25, 1.0),
        "pcb": material("PCB negro", (0.015, 0.03, 0.02), 0.4),
        "pcb2": material("PCB azul", (0.02, 0.05, 0.16), 0.4),
        "chip": material("Chip", (0.01, 0.01, 0.01), 0.3),
        "rubber": material("Goma", (0.25, 0.02, 0.02), 0.8),
        "cap": material("Condensador", (0.02, 0.05, 0.25), 0.3),
        "battery": material("Bateria", (0.45, 0.05, 0.03), 0.45),
        "xt60": material("XT60", (0.75, 0.6, 0.05), 0.4),
        "vtx": material("Disipador", (0.55, 0.56, 0.6), 0.3, 1.0),
        "ceramic": material("Ceramica GPS", (0.75, 0.7, 0.6), 0.6),
        "cam": material("Camara", (0.02, 0.02, 0.022), 0.35),
        "glass": material("Cristal", (0.02, 0.05, 0.08), 0.02, 0.0, None, 1.0, 0.0),
        "led": material("LED amarillo", (0.9, 0.65, 0.02), 0.3, 0.0, (1.0, 0.7, 0.05)),
        "antenna": material("Antena", (0.75, 0.5, 0.2), 0.3, 1.0),
    }


def write_stl(ob, path, mat=Matrix()):
    me = ob.data.copy()
    me.transform(mat)
    me.calc_loop_triangles()
    co = [v.co for v in me.vertices]
    with open(path, "wb") as f:
        f.write(b"VECTOR-X drone part (mm)".ljust(80, b" "))
        f.write(struct.pack("<I", len(me.loop_triangles)))
        for t in me.loop_triangles:
            n = t.normal
            a, b, c = (co[i] for i in t.vertices)
            f.write(struct.pack("<12fH", n.x, n.y, n.z, a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, 0))
    bpy.data.meshes.remove(me)


def print_matrix(ob, flip=False, rot_z=0.0):
    """Coloca la pieza sobre la cama: centrada en XY, z mín = 0."""
    R = Matrix.Rotation(math.pi, 4, "X") if flip else Matrix()
    R = Rz(rot_z) @ R
    pts = [R @ v.co for v in ob.data.vertices]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return T(-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, -mn.z) @ R, mx - mn


def setup_scene():
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    sc.unit_settings.scale_length = 0.001
    sc.unit_settings.length_unit = "MILLIMETERS"
    return sc


def main():
    global CUTTERS
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)
    sc = setup_scene()
    CUTTERS = coll("_cortadores")
    PRN = coll("Piezas imprimibles")
    REF = coll("Electronica y hardware (referencia)")
    mats = make_materials()

    print("Booleanas con solver:", SOLVER)
    parts = []   # (objeto, nombre_stl, cantidad, flip, rot_z, notas)

    def add_part(ob, fname, qty, flip, mat, note, rot=0.0):
        finish(ob, PRN, mats[mat])
        parts.append((ob, fname, qty, flip, rot, note))
        print("  pieza:", ob.name)

    add_part(make_tail(), "01_cola_con_aletas", 1, True, "body", "Imprimir con el labio hacia la cama")
    add_part(make_tail_cap(), "02_tapa_cola", 1, False, "body", "Brida sobre la cama")
    add_part(make_stack_plate(), "03_placa_pila_fc", 1, False, "hub", "Plana")
    add_part(make_hub(True), "04_buje_inferior", 1, True, "hub", "Cara de partición sobre la cama")
    add_part(make_hub(False), "05_buje_superior", 1, False, "hub", "Cara de partición sobre la cama")
    arms = []
    for i, a in enumerate(ARM_ANGLES):
        arm = make_arm()
        cap = make_pod_cap()
        if i == 0:
            arm_local, cap_local = arm.copy(), cap.copy()
            arm_local.data, cap_local.data = arm.data.copy(), cap.data.copy()
        arm.data.transform(Rz(a))
        cap.data.transform(Rz(a))
        arm.name, cap.name = "brazo_%d" % (i + 1), "cupula_motor_%d" % (i + 1)
        finish(arm, PRN, mats["body"])
        finish(cap, PRN, mats["body"])
        arms.append((arm, cap))
    parts.append((arm_local, "06_brazo_con_gondola", 4, False, 0.0, "Base del motor sobre la cama"))
    parts.append((cap_local, "07_cupula_motor", 4, False, 0.0, "Labio sobre la cama"))
    add_part(make_upper(), "08_cuerpo_superior", 1, False, "body", "De pie")
    add_part(make_avionics_plate(), "09_placa_avionica", 1, False, "hub", "Plana")
    add_part(make_camera_mount(), "10_soporte_camara_gps", 1, False, "hub", "Disco sobre la cama")
    add_part(make_nose(), "11_nariz_con_mastil", 1, False, "body", "De pie, punta arriba")

    print("Electrónica de referencia...")
    refs = build_reference(REF, mats)

    # limpiar cortadores sobrantes
    for o in list(CUTTERS.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.collections.remove(CUTTERS)

    # ---------------- informe + STL
    out_stl = os.path.join(HERE, "stl")
    os.makedirs(out_stl, exist_ok=True)
    report = ["| # | Archivo | Cant. | Tamaño en cama (mm) | Volumen (cm³) | Bordes no-manifold | Orientación |",
              "|---|---|---|---|---|---|---|"]
    total_vol = 0.0
    for ob, fname, qty, flip, rot, note in parts:
        nm, vol, tris = mesh_report(ob)
        M, size = print_matrix(ob, flip, rot)
        total_vol += vol * qty / 1000.0
        report.append("| %s | `%s.stl` | %d | %.1f × %.1f × %.1f | %.1f | %d | %s |" % (
            fname[:2], fname, qty, size.x, size.y, size.z, vol / 1000.0, nm, note))
        if "--no-export" not in ARGS:
            write_stl(ob, os.path.join(out_stl, fname + ".stl"), M)
        print("  %-26s x%d  vol=%7.1f cm3  tris=%6d  no-manifold=%d" % (fname, qty, vol / 1000, tris, nm))
    report.append("")
    report.append("Volumen sólido total de plástico: **%.0f cm³** (≈ %.0f g en PETG macizo; "
                  "≈ %.0f g con 3 perímetros y 20 %% de relleno)." % (total_vol, total_vol * 1.27,
                                                                     total_vol * 1.27 * 0.55))
    with open(os.path.join(HERE, "stl", "INFORME_PIEZAS.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(report) + "\n")
    print("\n".join(report))
    for ob in (arm_local, cap_local):
        bpy.data.objects.remove(ob, do_unlink=True)

    # ---------------- vista explosionada (colección aparte, oculta)
    EXP = coll("Vista explosionada")
    for ob in list(PRN.objects) + refs:
        cp = ob.copy()
        cp.data = ob.data
        EXP.objects.link(cp)
        cp.location = explode_offset(ob)
    EXP.hide_viewport = True
    EXP.hide_render = True

    # ---------------- guardar .blend y .glb
    if "--render" in ARGS:
        render_all(PRN, REF, EXP, mats)
    if "--no-export" not in ARGS:
        os.makedirs(os.path.join(HERE, "web"), exist_ok=True)
        export_glb(os.path.join(HERE, "web", "dron_ensamblado.glb"), [PRN, REF])
        export_glb(os.path.join(HERE, "web", "dron_explosionado.glb"), [EXP])
    if "--no-export" not in ARGS:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "dron_vector_x.blend"), compress=True)
    print("Listo.")


EXPLODE_Z = {"cola": -150, "tapa_cola": -215, "placa_pila": -32, "buje_inferior": -12, "buje_superior": 12,
             "cuerpo_superior": 45, "placa_avionica": 32, "soporte_camara": 85, "nariz": 185,
             "ESC": 0, "mos": 0, "Controladora": 12, "MCU": 12, "IMU": 12, "Barometro": 12, "USB": 12,
             "separador": 0, "Condensador": -48, "Bateria": -48, "XT60": -48, "ToF": -215,
             "VTX": 34, "Receptor": 30, "Buzzer": 30, "GPS": 85, "gps_ant": 85, "Camara": 110, "Lente": 110,
             "led": 45, "Antena": 205}


def explode_offset(ob):
    key = ob.name.split(".")[0]
    bb = [Vector(c) for c in ob.bound_box]
    c = sum(bb, Vector()) / 8.0
    rxy = math.hypot(c.x, c.y)
    off = Vector((0, 0, 0))
    if rxy > 60:   # brazos, góndolas, motores, hélices
        off += Vector((c.x, c.y, 0)).normalized() * 45
        if key.startswith("cupula"):
            off.z += 32
        elif key.startswith("Motor"):
            off.z -= 28
        elif key.startswith("Helice"):
            off.z -= 60
        elif key == "t":
            off.z += 12
        return off
    if key in ("perno", "tuerca"):
        off += Vector((c.x, c.y, 0)).normalized() * 45
        off.z += 30 if c.z > Z_ARM else -30
        return off
    for k, dz in EXPLODE_Z.items():
        if key.startswith(k):
            off.z = dz
            break
    return off


def export_glb(path, collections):
    bpy.ops.object.select_all(action="DESELECT")
    vis = {}
    for c in bpy.data.collections:
        vis[c.name] = (c.hide_viewport, c.hide_render)
        on = c in collections
        c.hide_viewport = not on
        c.hide_render = not on
    # glTF usa metros: escalamos 1 mm -> 0.001 m en el exportador mediante un objeto padre temporal
    root = bpy.data.objects.new("VECTOR-X", None)
    bpy.context.scene.collection.objects.link(root)
    root.scale = (0.001, 0.001, 0.001)
    sel = []
    for c in collections:
        for o in c.objects:
            o.parent = root
            o.select_set(True)
            sel.append(o)
    root.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True)
    for o in sel:
        o.parent = None
    bpy.data.objects.remove(root, do_unlink=True)
    bpy.context.view_layer.update()
    for c in bpy.data.collections:
        if c.name in vis:
            c.hide_viewport, c.hide_render = vis[c.name]


# ----------------------------------------------------------------------------
# Render (Cycles)
# ----------------------------------------------------------------------------
def render_all(PRN, REF, EXP, mats):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = int(os.environ.get("SAMPLES", "96"))
    sc.cycles.use_denoising = True
    sc.render.resolution_x = sc.render.resolution_y = int(os.environ.get("RES", "1400"))
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"

    world = bpy.data.worlds.new("Estudio")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.82, 0.83, 0.85, 1)
    bg.inputs["Strength"].default_value = 0.55
    sc.world = world

    L = coll("_luces")

    def area(name, loc, size, energy, color=(1, 1, 1)):
        ld = bpy.data.lights.new(name, "AREA")
        ld.size = size
        ld.energy = energy
        ld.color = color
        o = bpy.data.objects.new(name, ld)
        o.location = loc
        d = Vector((0, 0, 140)) - Vector(loc)
        o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        L.objects.link(o)
    area("clave", (450, -380, 620), 420, 2.6e6)
    area("relleno", (-520, -200, 260), 500, 1.1e6, (0.85, 0.9, 1.0))
    area("contra", (-150, 520, 520), 300, 1.6e6)

    # suelo de estudio (curva infinita)
    fl = lathe("suelo", [(0, -0.5), (3000, -0.5), (3000, 0.0), (0, 0.0)], 64, collection=L)
    fl.data.materials.append(material("Suelo", (0.6, 0.61, 0.63), 0.7))

    camd = bpy.data.cameras.new("Cam")
    camd.lens = 85
    camd.clip_end = 10000.0
    camd.sensor_width = 36
    cam = bpy.data.objects.new("Camara render", camd)
    L.objects.link(cam)
    sc.camera = cam
    out = os.path.join(HERE, "renders")
    os.makedirs(out, exist_ok=True)

    only = [x for x in os.environ.get("SHOTS", "").split(",") if x]

    def shot(fname, loc, target, lens=85, show=(PRN, REF), floor=True):
        if only and not any(fname.startswith(o) for o in only):
            return
        for c in (PRN, REF, EXP):
            c.hide_render = c not in show
            c.hide_viewport = c not in show
        fl.hide_render = not floor
        cam.location = loc
        camd.lens = lens
        cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = os.path.join(out, fname)
        bpy.ops.render.render(write_still=True)
        print("  render:", fname)

    shot("01_vista_heroica.png", (520, -640, 420), (0, 0, 120), 70)
    shot("02_vista_frontal.png", (0, -900, 150), (0, 0, 140), 70)
    shot("03_vista_inferior.png", (380, -420, -520), (0, 0, 120), 70, floor=False)
    shot("04_electronica_interna.png", (430, -560, 380), (0, 0, 150), 60, show=(REF,))
    shot("05_vista_explosionada.png", (900, -1050, 520), (0, 0, 135), 55, show=(EXP,), floor=False)
    # variante de color "Racing" (azul marino + naranja, sin marcas registradas)
    mats["body"].node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.012, 0.02, 0.08, 1)
    mats["hub"].node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.9, 0.12, 0.02, 1)
    shot("06_variante_racing.png", (520, -640, 420), (0, 0, 120), 70)
    mats["body"].node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.018, 0.018, 0.02, 1)
    mats["hub"].node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.09, 0.09, 0.095, 1)
    for c in (PRN, REF):
        c.hide_render = False
    bpy.data.collections.remove(L) if False else None


if __name__ == "__main__":
    main()
