// Generador determinista de G-code "tipo Kiri" para medir y calibrar el lector de recorridos
// (scripts/medir-recorridos.mjs y scripts/recorridos/niveles.mjs). No se commitea ningún G-code grande.
//
// Por capa: perímetros circulares de muchos segmentos cortos (como las curvas finas de Kiri), un rectángulo,
// relleno en zigzag y relleno sólido (rectas largas), con retracciones, cambios de `; feature` y subida de Z.

/** Generador pseudoaleatorio chico y determinista (mulberry32). */
function azar(semilla) {
    let a = semilla >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const f = n => n.toFixed(3);

/** Líneas de G-code con E absoluto. */
class Salida {
    constructor() {
        this.s = [];
        this.e = 0;
        this.px = 0;
        this.py = 0;
    }
    get lineas() {
        return this.s.length;
    }
    linea(t) {
        this.s.push(t);
    }
    viaje(x, y) {
        this.linea(`G0 X${f(x)} Y${f(y)} F9000`);
        this.px = x;
        this.py = y;
    }
    extruir(x, y) {
        this.e += Math.hypot(x - this.px, y - this.py) * 0.04;
        this.linea(`G1 X${f(x)} Y${f(y)} E${this.e.toFixed(4)}`);
        this.px = x;
        this.py = y;
    }
    retraer(mm) {
        this.e += mm;
        this.linea(`G1 E${this.e.toFixed(4)} F2400`);
    }
}

/** Círculo de radio r con segmentos de unos `paso` mm. */
function circulo(o, cx, cy, r, paso) {
    const n = Math.max(8, Math.round((2 * Math.PI * r) / paso));
    o.viaje(cx + r, cy);
    o.retraer(0.8);
    for (let i = 1; i <= n; i++) {
        const a = (2 * Math.PI * i) / n;
        o.extruir(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    o.retraer(-0.8);
}

/** Rectángulo: cuatro rectas largas, cada una con un punto intermedio alineado. */
function rectangulo(o, x0, y0, ancho, alto) {
    o.viaje(x0, y0);
    o.retraer(0.8);
    for (const [x, y] of [
        [x0 + ancho / 2, y0],
        [x0 + ancho, y0],
        [x0 + ancho, y0 + alto],
        [x0, y0 + alto],
        [x0, y0],
    ])
        o.extruir(x, y);
    o.retraer(-0.8);
}

/** Zigzag de rectas largas unidas por tramos cortos, con un punto intermedio alineado en cada recta. */
function zigzag(o, x0, y0, ancho, alto, sep) {
    o.viaje(x0, y0);
    o.retraer(0.8);
    for (let k = 0, y = y0; y <= y0 + alto; k++, y += sep) {
        const xf = k % 2 ? x0 : x0 + ancho;
        o.extruir((o.px + xf) / 2, y);
        o.extruir(xf, y);
        o.extruir(xf, y + sep / 2);
    }
    o.retraer(-0.8);
}

/**
 * Genera un G-code de varias capas con aproximadamente `lineas` líneas.
 * @param {number} [lineas] líneas objetivo
 * @param {number} [semilla] semilla del azar (la misma semilla da el mismo texto)
 * @returns {string}
 */
export function generarGcode(lineas = 200000, semilla = 1) {
    const rnd = azar(semilla);
    const o = new Salida();
    for (const l of ['; G-code sintético', 'M82', 'G90', 'G92 E0', 'G1 Z0.3', 'G1 X5 Y5 E0.5 ; purga, no se dibuja'])
        o.linea(l);
    o.e = 0.5;
    o.px = 5;
    o.py = 5;
    const objetos = [0, 1, 2].map(() => ({ cx: 40 + rnd() * 120, cy: 40 + rnd() * 120, r: 8 + rnd() * 25 }));
    const paso = 0.15 + rnd() * 0.2;
    for (let capa = 0; o.lineas < lineas; capa++) {
        o.linea(`;LAYER:${capa}`);
        o.linea(`G1 Z${f(0.3 + capa * 0.2)} F1200`);
        o.linea('; feature shells');
        for (const ob of objetos) {
            circulo(o, ob.cx, ob.cy, ob.r, paso);
            circulo(o, ob.cx, ob.cy, ob.r - 0.45, paso);
        }
        rectangulo(o, 150, 150, 30 + rnd() * 10, 30);
        o.linea('; feature solid fill');
        zigzag(o, 20, 20, 30, 3, 0.45);
        o.linea('; feature sparse infill');
        zigzag(o, 20, 60, 160, 40, 2.4);
        if (capa % 25 === 24) {
            o.linea('G92 E0');
            o.e = 0;
        }
    }
    return o.s.join('\n') + '\n';
}
