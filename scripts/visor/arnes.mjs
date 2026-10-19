// Arnés de las pruebas del visor: arma una pieza girada y centrada como lo hace visor.js (`ponerTransformacion` y
// `ponerCopias`), con copias en dos posiciones. Lo usan las pruebas de Node (scripts/probar-visor.mjs) y la del
// navegador (scripts/app/visor-bloqueos.mjs), así las dos miden lo mismo.

import * as THREE from 'three';

export const POSICIONES = [
    { x: -30, y: 12 },
    { x: 25, y: -18 },
];

/**
 * Pieza de 10×6×20 (caja) girada 90° sobre Z y centrada/apoyada en la cama, con una copia por posición.
 * @returns {{copias: THREE.Mesh[], local: THREE.Vector3, enGeometria: THREE.Vector3}} `local` es un punto de la superficie
 *   en el marco de la pieza y `enGeometria` el mismo punto en las coordenadas de los vértices (antes del giro)
 */
export function armarPieza() {
    const geo = new THREE.BoxGeometry(10, 6, 20);
    geo.translate(7, 3, 10); // lejos del origen a propósito: el centrado no puede ser la identidad
    geo.computeBoundingBox();
    const c = geo.boundingBox;
    geo.translate(-(c.min.x + c.max.x) / 2, -(c.min.y + c.max.y) / 2, -c.min.z);
    // Giro de 90° sobre Z (x→y, y→-x), igual que una matriz 3×3 de `transformar.js` aplicada a los vértices.
    const giro = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
    const caja = new THREE.Box3().setFromBufferAttribute(geo.attributes.position).applyMatrix4(giro);
    const matriz = giro
        .clone()
        .setPosition(-(caja.min.x + caja.max.x) / 2, -(caja.min.y + caja.max.y) / 2, -caja.min.z);
    const copias = POSICIONES.map(pos => {
        const copia = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
        copia.matrixAutoUpdate = false;
        copia.matrix.copy(matriz);
        copia.matrix.elements[12] += pos.x;
        copia.matrix.elements[13] += pos.y;
        copia.updateMatrixWorld(true);
        return copia;
    });
    // Tras el giro la caja mide 6 (X) × 10 (Y) × 20 (Z) y su centro está en el origen: la cara +X queda en x = 3.
    return { copias, local: new THREE.Vector3(3, 1.5, 12), enGeometria: new THREE.Vector3(1.5, -3, 12) };
}
