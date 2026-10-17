# Uso: coloca las fotos de referencia (2.webp AK, 3.webp Glock, 4.png M4) en la carpeta IMG y ejecuta
# python3 extraer_perfiles.py  (requiere opencv-python-headless y numpy). Genera js/perfiles.js.
import cv2, numpy as np, math
IMG='./referencias/'
def fondo(im):
    b,g,r=[im[:,:,i].astype(int) for i in range(3)]
    return (r>228)&(g>228)&(b>228)
def grid(vis):
    for x in range(0, vis.shape[1], 50): cv2.line(vis,(x,0),(x,vis.shape[0]),(0,70,0) if x%100 else (0,140,0),1); 
    for x in range(0, vis.shape[1], 100): cv2.putText(vis,str(x),(x+2,15),0,0.45,(0,255,0),1)
    for y in range(0, vis.shape[0], 50): cv2.line(vis,(0,y),(vis.shape[1],y),(0,70,0) if y%100 else (0,140,0),1)
    for y in range(0, vis.shape[0], 100): cv2.putText(vis,str(y),(2,y+14),0,0.45,(0,255,0),1)
def preparar(nombre):
    if nombre=='ak':
        im=cv2.imread(IMG+'2.webp')
        obj=~fondo(im)
        xs=np.arange(660,1150); tops=[np.where(obj[:,x])[0].min() for x in xs]
        a=math.degrees(math.atan2(np.polyfit(xs,tops,1)[0],1))
        M=cv2.getRotationMatrix2D((1000,700), a, 1.0)
        im=cv2.warpAffine(im,M,(im.shape[1],im.shape[0]),borderValue=(255,255,255))
        print('ak rotado', a)
    elif nombre=='glock':
        im=cv2.flip(cv2.imread(IMG+'3.webp'),1)
    else:
        im=cv2.imread(IMG+'4.png'); im[250:,:]=255  # quitar marca de agua
    return im
if False:
    for n in ['ak','glock','m4']:
        im=preparar(n); obj=~fondo(im)
        b,g,r=[im[:,:,i].astype(int) for i in range(3)]
        mad=obj&(r>g+25)&(r>70); cromo=obj&(r>110)&(abs(r-b)<25)&(abs(r-g)<25)
        vis=np.zeros_like(im); vis[obj]=(90,90,90); vis[mad]=(0,120,255); vis[cromo&~mad]=(220,220,220)
        if n=='m4': vis=cv2.resize(vis,None,fx=2,fy=2,interpolation=cv2.INTER_NEAREST)
        grid(vis); cv2.imwrite('prep_'+n+'.png',vis)
        cv2.imwrite('src_'+n+'.png', im)
# Extrae los perfiles laterales de las armas a partir de las fotos de referencia y los guarda
# como contornos en metros (origen en el pistolete, x hacia la boca, y hacia arriba).
import cv2, numpy as np, json


def clases(im):
    obj = ~fondo(im)
    b, g, r = [im[:, :, i].astype(int) for i in range(3)]
    mad = obj & (r > g + 25) & (r > 70)
    cromo = obj & (r > 110) & (abs(r - b) < 25) & (abs(r - g) < 25)
    return obj, mad, cromo

def caja(sh, x0, x1, y0, y1):
    m = np.zeros(sh, bool); m[max(0, y0):y1, max(0, x0):x1] = True; return m

def contornos(mask, s, ox, oy, eps):
    m = mask.astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    cs, jer = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    if jer is None: return out
    jer = jer[0]
    for i, c in enumerate(cs):
        if jer[i][3] != -1: continue  # es un hueco
        if cv2.contourArea(c) < 120: continue
        def conv(cc):
            a = cv2.approxPolyDP(cc, eps, True)[:, 0, :]
            return [v for p in a for v in (round(float((p[0] - ox) * s), 4), round(float(-(p[1] - oy) * s), 4))]
        huecos = []
        k = jer[i][2]
        while k != -1:
            if cv2.contourArea(cs[k]) > 60: huecos.append(conv(cs[k]))
            k = jer[k][0]
        out.append({'ext': conv(c), 'huecos': huecos})
    return out

def ancla(p, s, ox, oy): return [round((p[0] - ox) * s, 4), round(-(p[1] - oy) * s, 4)]

def ak():
    im = preparar('ak'); obj, mad, cromo = clases(im); met = obj & ~mad
    sh = obj.shape
    s = 0.88 / (1872 - 105); ox, oy = 640, 665
    piezas = [
        ('culata', 'madera', 0.042, mad & caja(sh, 0, 556, 0, 2000)),
        ('empunadura', 'madera', 0.03, mad & caja(sh, 556, 720, 640, 2000)),
        ('guardamanos', 'madera', 0.05, mad & caja(sh, 1040, 1400, 0, 2000)),
        ('cajon', 'acero', 0.046, met & (caja(sh, 545, 1166, 0, 668) | caja(sh, 690, 860, 640, 728))),
        ('cargador', 'acero', 0.029, met & caja(sh, 850, 1165, 660, 2000)),
        ('canon', 'acero', 0.022, met & caja(sh, 1166, 2000, 0, 2000)),
        ('anilla', 'acero', 0.01, met & caja(sh, 0, 545, 0, 2000)),
        ('tapa', 'cromo', 0.05, cromo & caja(sh, 850, 1025, 530, 605)),
    ]
    anclas = {'boca': ancla((1871, 646), s, ox, oy), 'riel': ancla((880, 503), s, ox, oy), 'alza': ancla((1020, 497), s, ox, oy),
              'manoIzq': ancla((1225, 640), s, ox, oy), 'ejeY': ancla((0, 600), s, ox, oy)[1]}
    return s, ox, oy, piezas, anclas

def m4():
    im = preparar('m4'); obj, mad, cromo = clases(im); met = obj
    sh = obj.shape
    s = 0.84 / (697 - 33); ox, oy = 236, 133
    holo = caja(sh, 268, 342, 0, 68); vgrip = caja(sh, 440, 478, 118, 300)
    piezas = [
        ('culata', 'polimero', 0.042, met & caja(sh, 0, 202, 0, 300)),
        ('inferior', 'aluminio', 0.03, met & caja(sh, 202, 372, 100, 300) & ~caja(sh, 296, 372, 150, 300)),
        ('cargador', 'acero', 0.024, met & caja(sh, 296, 372, 150, 300)),
        ('superior', 'aluminio', 0.03, met & caja(sh, 202, 372, 0, 100) & ~holo),
        ('guardamanos', 'aluminio', 0.055, met & caja(sh, 372, 520, 0, 118) & ~vgrip),
        ('canon', 'acero', 0.02, met & caja(sh, 520, 726, 0, 300)),
    ]
    anclas = {'boca': ancla((697, 89), s, ox, oy), 'riel': ancla((250, 66), s, ox, oy), 'alza': ancla((260, 66), s, ox, oy),
              'manoIzq': ancla((420, 108), s, ox, oy), 'ejeY': ancla((0, 89), s, ox, oy)[1]}
    return s, ox, oy, piezas, anclas

def glock():
    im = preparar('glock'); obj, mad, cromo = clases(im)
    sh = obj.shape
    s = 0.186 / (1941 - 159); ox, oy = 560, 690
    yy, xx = np.mgrid[0:sh[0], 0:sh[1]]
    corredera = obj & (yy < np.where(xx < 330, 300, 410))
    piezas = [
        ('corredera', 'acero', 0.0255, corredera),
        ('armazon', 'polimero', 0.031, obj & ~corredera),
    ]
    anclas = {'boca': ancla((1941, 165), s, ox, oy), 'riel': ancla((290, 72), s, ox, oy), 'alza': ancla((290, 40), s, ox, oy),
              'manoIzq': ancla((600, 760), s, ox, oy), 'ejeY': ancla((0, 165), s, ox, oy)[1]}
    return s, ox, oy, piezas, anclas

salida = {}
for nombre, fn in [('ak', ak), ('m4', m4), ('glock', glock)]:
    s, ox, oy, piezas, anclas = fn()
    eps = 0.0008 / s  # tolerancia de simplificación ~0,8 mm
    P = []
    for (n, mat, ancho, mask) in piezas:
        cs = contornos(mask, s, ox, oy, max(0.8, eps))
        npts = sum(len(c['ext']) // 2 + sum(len(h) // 2 for h in c['huecos']) for c in cs)
        print(nombre, n, 'contornos', len(cs), 'puntos', npts)
        if cs: P.append({'nombre': n, 'mat': mat, 'ancho': ancho, 'contornos': cs})
    salida[nombre] = {'piezas': P, 'anclas': anclas}
js = '// Perfiles laterales de armas extraídos de fotografías de referencia (generado por herramientas/extraer_perfiles.py).\n'
js += '// Coordenadas en metros: x hacia la boca, y hacia arriba, origen en el pistolete.\nexport const PERFILES = ' + json.dumps(salida, separators=(',', ':')) + ';\n'
open('../js/perfiles.js', 'w').write(js)
print('bytes', len(js))
