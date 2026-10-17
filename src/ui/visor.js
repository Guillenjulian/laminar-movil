// Visor 3D del modelo sobre la cama, con gestos táctiles:
//   1 dedo: girar · 2 dedos: zoom y mover · doble toque: volver a la vista inicial.
// Usamos Z hacia arriba, igual que la impresora.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export function crearVisor(contenedor) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); // más de 2x no se nota y gasta batería
    contenedor.appendChild(renderer.domElement);

    const escena = new THREE.Scene();
    escena.add(new THREE.HemisphereLight(0xffffff, 0x667788, 2));
    const sol = new THREE.DirectionalLight(0xffffff, 1.5);
    sol.position.set(-1, -2, 3);
    escena.add(sol);

    const camara = new THREE.PerspectiveCamera(40, 1, 1, 5000);
    camara.up.set(0, 0, 1);

    const controles = new OrbitControls(camara, renderer.domElement);
    controles.enableDamping = true;
    controles.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    let cama = null, modelo = null, tamanoCama = { x: 220, y: 220, z: 250 };

    // Cama: un plano con una grilla cada 10 mm, centrada en el origen.
    function ponerCama({ x, y, z }) {
        tamanoCama = { x, y, z };
        if (cama) {
            escena.remove(cama);
            cama.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
        }
        cama = new THREE.Group();
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
        cama.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(-x / 2, -y / 2, 0), 20, 0xd03030));
        cama.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-x / 2, -y / 2, 0), 20, 0x30a030));
        escena.add(cama);
    }

    // Modelo: se centra en la cama y se apoya en Z=0, igual que al laminar.
    function ponerModelo(vertices) {
        quitarModelo();
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geo.computeBoundingBox();
        const c = geo.boundingBox;
        geo.translate(-(c.min.x + c.max.x) / 2, -(c.min.y + c.max.y) / 2, -c.min.z);
        geo.computeVertexNormals();
        modelo = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xf08a24, roughness: 0.6, flatShading: true }));
        escena.add(modelo);
        vistaInicial();
    }

    function quitarModelo() {
        if (!modelo) return;
        escena.remove(modelo);
        modelo.geometry.dispose();
        modelo.material.dispose();
        modelo = null;
    }

    // Encuadra el modelo (o la cama si no hay modelo) desde adelante y arriba.
    function vistaInicial() {
        let centro, radio;
        if (modelo) {
            modelo.geometry.computeBoundingSphere();
            const s = modelo.geometry.boundingSphere;
            centro = s.center.clone();
            radio = Math.max(s.radius, 15);
        } else {
            centro = new THREE.Vector3(0, 0, 0);
            radio = Math.max(tamanoCama.x, tamanoCama.y) / 2;
        }
        // Un poco más lejos de lo justo, para que se vea la cama alrededor.
        const dist = radio / Math.sin((camara.fov * Math.PI) / 360) * 1.8;
        camara.position.copy(centro).add(new THREE.Vector3(0, -dist * 0.6, dist * 0.8));
        controles.target.copy(centro);
        controles.update();
    }

    // Doble toque (o doble clic) para volver a la vista inicial.
    renderer.domElement.addEventListener('dblclick', vistaInicial);

    // Ajustar al tamaño del contenedor.
    function ajustar() {
        const { width, height } = contenedor.getBoundingClientRect();
        if (!width || !height) return;
        renderer.setSize(width, height, false);
        camara.aspect = width / height;
        camara.updateProjectionMatrix();
    }
    new ResizeObserver(ajustar).observe(contenedor);

    // Sólo dibujamos mientras el visor está a la vista (ahorra batería).
    let activo = true;
    renderer.setAnimationLoop(() => {
        if (!activo) return;
        controles.update();
        renderer.render(escena, camara);
    });

    ponerCama(tamanoCama);
    ajustar();

    return {
        ponerCama,
        ponerModelo,
        quitarModelo,
        vistaInicial,
        pausar(p) { activo = !p; },
    };
}
