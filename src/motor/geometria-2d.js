// Geometría 2D mínima para los soportes árbol (ADR 0004): funciones puras, sin imports ni DOM.
//
//   puntoEnPoligono     ¿el punto está dentro de un polígono? (par-impar)
//   distanciaAPoligono  distancia firmada de un punto al borde de un conjunto de polígonos
//   circulo             polígono regular que aproxima un círculo
//   areaPoligono        área con signo (fórmula del cordón)
//
// Un polígono es un array de puntos `{x, y}` en mm, con el anillo cerrado de forma implícita (el último punto no
// repite el primero). Un conjunto de polígonos se interpreta con la regla par-impar: un polígono adentro de otro
// es un agujero.

/** @typedef {{x:number, y:number}} Punto  mm */
/** @typedef {Punto[]} Poligono  anillo cerrado implícito (el último punto no repite el primero) */

/**
 * ¿El punto está dentro del polígono? Trazamos un rayo hacia +x y contamos cuántas aristas cruza: impar = adentro.
 * Un punto justo sobre el borde puede dar cualquiera de los dos resultados; para distancias usá `distanciaAPoligono`.
 * @param {Punto} p
 * @param {Poligono} poligono
 * @returns {boolean}
 */
export function puntoEnPoligono(p, poligono) {
    let dentro = false;
    for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
        const a = poligono[i];
        const b = poligono[j];
        // La arista cruza la horizontal de `p` (con el criterio semiabierto para no contar dos veces un vértice)...
        if (a.y > p.y === b.y > p.y) continue;
        // ...y el cruce queda a la derecha del punto.
        const xCruce = a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y);
        if (p.x < xCruce) dentro = !dentro;
    }
    return dentro;
}

// Distancia al cuadrado de `p` al segmento a-b: proyectamos `p` sobre la recta y acotamos el parámetro a [0, 1].
function distancia2ASegmento(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const largo2 = dx * dx + dy * dy;
    const t = largo2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / largo2));
    const ex = a.x + t * dx - p.x;
    const ey = a.y + t * dy - p.y;
    return ex * ex + ey * ey;
}

/**
 * Distancia (mm) de `p` al borde más cercano de un conjunto de polígonos; negativa si `p` está adentro (par-impar
 * sobre todo el conjunto, así que los agujeros cuentan como afuera). Con un conjunto vacío da `Infinity`.
 * @param {Punto} p
 * @param {Poligono[]} poligonos
 * @returns {number}
 */
export function distanciaAPoligono(p, poligonos) {
    let mejor2 = Infinity;
    let cruces = 0;
    for (const poligono of poligonos) {
        for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
            const d2 = distancia2ASegmento(p, poligono[i], poligono[j]);
            if (d2 < mejor2) mejor2 = d2;
        }
        if (puntoEnPoligono(p, poligono)) cruces++;
    }
    const d = Math.sqrt(mejor2);
    return cruces % 2 === 1 ? -d : d;
}

/**
 * Círculo aproximado por un polígono regular, antihorario, con el primer vértice en +x. Los vértices quedan sobre
 * la circunferencia de radio `radio` (el polígono queda adentro del círculo).
 * @param {Punto} centro
 * @param {number} radio  mm
 * @param {number} [lados=8]
 * @returns {Poligono}
 */
export function circulo(centro, radio, lados = 8) {
    const puntos = [];
    for (let k = 0; k < lados; k++) {
        const ang = (2 * Math.PI * k) / lados;
        puntos.push({ x: centro.x + radio * Math.cos(ang), y: centro.y + radio * Math.sin(ang) });
    }
    return puntos;
}

/**
 * Área con signo: positiva si el polígono es antihorario (eje y hacia arriba), negativa si es horario.
 * @param {Poligono} poligono
 * @returns {number}  mm²
 */
export function areaPoligono(poligono) {
    let suma = 0;
    for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
        suma += poligono[j].x * poligono[i].y - poligono[i].x * poligono[j].y;
    }
    return suma / 2;
}
