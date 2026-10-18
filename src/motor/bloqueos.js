// Zonas sin soporte (ADR 0004): esferas que bloquean el soporte, puras y sin Kiri ni DOM.
//
// Una esfera `Bloqueo` ({ id, forma:'esfera', centro:{x,y,z}, radio }) está en el marco local de la pieza, en mm.
// Acá vive la parte pura: validar lo que llega, cortar la esfera a una altura (un círculo) y restarlo de la
// sombra. La resta de polígonos de verdad la pone el puente con Kiri (`POLY.subtract`), que entra por parámetro.

/** @typedef {{x:number, y:number}} Punto  mm */
/** @typedef {Punto[]} Poligono  anillo cerrado implícito */
/** @typedef {{id:number, forma:'esfera', centro:{x:number,y:number,z:number}, radio:number}} Bloqueo */

export const RADIO_MIN_MM = 2;
export const RADIO_MAX_MM = 40;
export const RADIO_INICIAL_MM = 8;
export const MAX_BLOQUEOS = 20; // por pieza

const esNumero = n => typeof n === 'number' && Number.isFinite(n);

/**
 * Limpia un bloqueo suelto: devuelve una copia saneada o `null` si no sirve.
 * @param {any} b
 * @returns {Bloqueo|null}
 */
function limpiarBloqueo(b) {
    if (!b || typeof b !== 'object' || b.forma !== 'esfera') return null;
    const { x, y, z } = b.centro ?? {};
    if (![b.id, x, y, z, b.radio].every(esNumero) || b.radio <= 0) return null;
    const radio = Math.min(RADIO_MAX_MM, Math.max(RADIO_MIN_MM, b.radio));
    return { id: b.id, forma: 'esfera', centro: { x, y, z }, radio };
}

/**
 * Limpia lo que llega de la UI o del mensaje al worker: descarta formas desconocidas, números no finitos y radios
 * no positivos, acota los radios a RADIO_MIN_MM..RADIO_MAX_MM y corta en MAX_BLOQUEOS.
 * @param {unknown} datos
 * @returns {Bloqueo[]}
 */
export function validarBloqueos(datos) {
    if (!Array.isArray(datos)) return [];
    return datos.map(limpiarBloqueo).filter(Boolean).slice(0, MAX_BLOQUEOS);
}

/**
 * Polígono regular de `lados` vértices CIRCUNSCRIPTO al círculo de radio `r`: los vértices están a r/cos(π/lados)
 * y los puntos medios de los lados caen justo en `r`. Así la zona bloqueada nunca queda más chica que la esfera
 * (decisión del CTO). Su área es lados·r²·tan(π/lados): con 16 lados, ~1,3 % más que el círculo ideal. Antihorario.
 * @param {{x:number, y:number}} c
 * @param {number} r
 * @param {number} lados
 * @returns {Poligono}
 */
function circulo(c, r, lados) {
    const paso = (2 * Math.PI) / lados;
    const rv = r / Math.cos(Math.PI / lados);
    return Array.from({ length: lados }, (_, i) => ({
        x: c.x + rv * Math.cos(i * paso),
        y: c.y + rv * Math.sin(i * paso),
    }));
}

/**
 * Secciones de los bloqueos a la altura `z`: un círculo (polígono circunscripto) de radio √(R² − dz²) por esfera que la cruza.
 * Si |dz| ≥ R la esfera no cruza el plano (a lo sumo lo toca en un punto) y no aporta nada.
 * @param {Bloqueo[]|undefined} bloqueos
 * @param {number} z  mm
 * @param {number} [lados=16]
 * @returns {Poligono[]}  vacío si ninguna esfera cruza esa altura
 */
export function seccionBloqueos(bloqueos, z, lados = 16) {
    const secciones = [];
    for (const b of bloqueos ?? []) {
        const dz = z - b.centro.z;
        if (Math.abs(dz) >= b.radio) continue;
        secciones.push(circulo(b.centro, Math.sqrt(b.radio * b.radio - dz * dz), lados));
    }
    return secciones;
}

/**
 * ¿El punto está dentro de alguna esfera (con `margen` mm de más)?
 * @param {Bloqueo[]|undefined} bloqueos
 * @param {{x:number, y:number, z:number}} p
 * @param {number} [margen=0]
 * @returns {boolean}
 */
export function bloqueaPunto(bloqueos, p, margen = 0) {
    return (bloqueos ?? []).some(b => {
        const dx = p.x - b.centro.x;
        const dy = p.y - b.centro.y;
        const dz = p.z - b.centro.z;
        return Math.hypot(dx, dy, dz) <= b.radio + margen;
    });
}

/**
 * Resta de la sombra de una capa las secciones de los bloqueos a esa altura. La resta geométrica la hace
 * `restar(sombra, secciones)` (en la app, el puente con `POLY.subtract` de Kiri); acá se decide qué restar.
 * Sin secciones (lista vacía o ninguna esfera cruza `z`) devuelve el MISMO `shadow` (identidad, la misma
 * referencia): así el caso común no cuesta nada y no se toca lo que Kiri ya calculó.
 * @template S
 * @param {S[]} shadow  polígonos de la sombra (el tipo lo define quien resta)
 * @param {number} z  mm, marco local de la pieza
 * @param {Bloqueo[]|undefined} bloqueos
 * @param {(sombra: S[], secciones: Poligono[]) => S[]} restar
 * @returns {S[]}
 */
export function sinBloqueos(shadow, z, bloqueos, restar) {
    const secciones = seccionBloqueos(bloqueos, z);
    return secciones.length ? restar(shadow, secciones) : shadow;
}
