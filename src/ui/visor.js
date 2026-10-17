// Visor 3D del modelo sobre la cama, con gestos táctiles:
//   1 dedo: girar · 2 dedos: zoom y mover · doble toque: volver a la vista inicial.
// Usamos Z hacia arriba, igual que la impresora.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CUANTIZADO } from '../motor/tipos-linea.js';

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
    let recorridos = null; // { grupo, abajo, actual, inicioCapa, esfera }

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
        redibujar();
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
        redibujar();
    }

    // Recorridos del G-code (vista previa capa por capa). Las capas de abajo se
    // dibujan atenuadas y la actual con todo su color; las dos comparten los
    // mismos datos y sólo cambia qué tramo se dibuja (por eso el deslizador es instantáneo).
    function ponerRecorridos({ posiciones, colores, inicioCapa, caja }, { origenCentro }) {
        quitarRecorridos();
        const pos = new THREE.BufferAttribute(posiciones, 3);
        const col = new THREE.BufferAttribute(colores, 3, true);
        const geometria = () => {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', pos);
            g.setAttribute('color', col);
            return g;
        };
        const abajo = new THREE.LineSegments(geometria(), new THREE.LineBasicMaterial({
            vertexColors: true, color: 0x9a9a9a, transparent: true, opacity: 0.55,
        }));
        const actual = new THREE.LineSegments(geometria(), new THREE.LineBasicMaterial({ vertexColors: true }));
        // Sin "frustum culling": three.js tendría que recorrer millones de puntos para
        // calcular la caja, y la pieza siempre está a la vista.
        abajo.frustumCulled = actual.frustumCulled = false;
        const grupo = new THREE.Group();
        grupo.add(abajo, actual);
        // De enteros a mm, y del origen de la impresora al centro de la cama del visor.
        const { ESCALA, DESPLAZAMIENTO } = CUANTIZADO;
        const dx = origenCentro ? 0 : tamanoCama.x / 2, dy = origenCentro ? 0 : tamanoCama.y / 2;
        grupo.scale.setScalar(1 / ESCALA);
        grupo.position.set(-DESPLAZAMIENTO - dx, -DESPLAZAMIENTO - dy, -DESPLAZAMIENTO);
        escena.add(grupo);

        const centro = new THREE.Vector3(
            (caja.min[0] + caja.max[0]) / 2 - dx, (caja.min[1] + caja.max[1]) / 2 - dy, (caja.min[2] + caja.max[2]) / 2);
        const radio = Math.hypot(caja.max[0] - caja.min[0], caja.max[1] - caja.min[1], caja.max[2] - caja.min[2]) / 2;
        recorridos = { grupo, abajo, actual, inicioCapa, col, esfera: { centro, radio } };
        vistaInicial();
    }

    // Muestra hasta la capa n (o sólo esa capa).
    function mostrarCapa(n, sola = false) {
        if (!recorridos) return;
        const { abajo, actual, inicioCapa } = recorridos;
        const desde = inicioCapa[n], hasta = inicioCapa[n + 1];
        actual.geometry.setDrawRange(desde * 2, (hasta - desde) * 2);
        abajo.geometry.setDrawRange(0, desde * 2);
        abajo.visible = !sola;
        redibujar();
    }

    // Cambia los colores de los recorridos: `rellenar(array)` escribe RGB por vértice.
    function pintarRecorridos(rellenar) {
        if (!recorridos) return;
        rellenar(recorridos.col.array);
        recorridos.col.needsUpdate = true;
        redibujar();
    }

    // Cuánto se atenúan las capas de abajo: fuerte por tipo de línea (para que resalte la
    // capa actual) y suave por filamento (para que se vean bien los colores).
    function atenuarAbajo(fuerte) {
        if (!recorridos) return;
        recorridos.abajo.material.color.set(fuerte ? 0x9a9a9a : 0xe6e6e6);
        recorridos.abajo.material.opacity = fuerte ? 0.55 : 0.9;
        redibujar();
    }

    function quitarRecorridos() {
        if (!recorridos) return;
        escena.remove(recorridos.grupo);
        recorridos.abajo.geometry.dispose();
        recorridos.actual.geometry.dispose();
        recorridos.abajo.material.dispose();
        recorridos.actual.material.dispose();
        recorridos = null;
        redibujar();
    }

    // Encuadra lo que haya (recorridos, modelo o la cama) desde adelante y arriba.
    function vistaInicial() {
        let centro, radio, margen = 1.8; // un poco más lejos de lo justo, para ver la cama alrededor
        if (recorridos) {
            margen = 1.2; // en la vista previa interesa la pieza, de cerca
            centro = recorridos.esfera.centro.clone();
            radio = Math.max(recorridos.esfera.radio, 15);
        } else if (modelo) {
            modelo.geometry.computeBoundingSphere();
            const s = modelo.geometry.boundingSphere;
            centro = s.center.clone();
            radio = Math.max(s.radius, 15);
        } else {
            centro = new THREE.Vector3(0, 0, 0);
            radio = Math.max(tamanoCama.x, tamanoCama.y) / 2;
        }
        const dist = radio / Math.sin((camara.fov * Math.PI) / 360) * margen;
        camara.position.copy(centro).add(new THREE.Vector3(0, -dist * 0.6, dist * 0.8));
        controles.target.copy(centro);
        controles.update();
        redibujar();
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
        redibujar();
    }
    new ResizeObserver(ajustar).observe(contenedor);

    // Sólo dibujamos cuando algo cambia (gesto, capa, tamaño) y mientras el visor
    // está a la vista: con millones de líneas, redibujar cada cuadro gasta mucha batería.
    let activo = true, sucio = true;
    const redibujar = () => { sucio = true; };
    renderer.setAnimationLoop(() => {
        if (!activo) return;
        const seMovio = controles.update(); // true mientras dura el gesto (y su inercia)
        if (seMovio || sucio) {
            renderer.render(escena, camara);
            sucio = false;
        }
    });

    ponerCama(tamanoCama);
    ajustar();

    return {
        ponerCama,
        ponerModelo,
        quitarModelo,
        ponerRecorridos,
        mostrarCapa,
        pintarRecorridos,
        atenuarAbajo,
        quitarRecorridos,
        vistaInicial,
        pausar(p) { activo = !p; redibujar(); },
    };
}
