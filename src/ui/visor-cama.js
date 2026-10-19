// Visor: la cama (un plano con una grilla cada 10 mm, centrada en el origen y con la marca del origen).
// Lo usa visor.js; no toca el DOM al importarse.

import * as THREE from 'three';

/**
 * Pone en la escena la cama de `x` × `y` mm, sacando (y liberando) la anterior si había.
 * @param {THREE.Scene} escena
 * @param {THREE.Group|null} anterior  la cama puesta antes, o null
 * @param {{x:number, y:number}} medidas  ancho y fondo de la cama (mm)
 * @returns {THREE.Group} la cama nueva
 */
export function reemplazarCama(escena, anterior, { x, y }) {
    if (anterior) {
        escena.remove(anterior);
        anterior.traverse(o => {
            o.geometry?.dispose();
            o.material?.dispose();
        });
    }
    const cama = construirCama(x, y);
    escena.add(cama);
    return cama;
}

function construirCama(x, y) {
    const cama = new THREE.Group();
    const plano = new THREE.Mesh(
        new THREE.PlaneGeometry(x, y),
        new THREE.MeshBasicMaterial({ color: 0x8090a0, transparent: true, opacity: 0.25 }),
    );
    plano.position.z = -0.05;
    cama.add(plano);
    const grilla = new THREE.GridHelper(Math.max(x, y), Math.max(x, y) / 10, 0x8899aa, 0x8899aa);
    grilla.rotation.x = Math.PI / 2;
    grilla.material.transparent = true;
    grilla.material.opacity = 0.35;
    cama.add(grilla);
    // Marca del origen (esquina frontal izquierda): X roja, Y verde.
    const origen = new THREE.Vector3(-x / 2, -y / 2, 0);
    cama.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), origen, 20, 0xd03030));
    cama.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), origen, 20, 0x30a030));
    return cama;
}
