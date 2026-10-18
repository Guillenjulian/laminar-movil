// Pruebas de los accesores de `estado.piezas` (ADR 0003, T7) en Node, sin navegador ni DOM.
// Se llama desde probar-contratos.mjs (`npm run test:contratos`), que pasa el cargador de Vite porque
// estado.js importa JSON de perfiles y Node solo no lo resuelve.
// Cubre: sin pieza (valores iniciales, el setter no hace nada), con pieza (lee y escribe en la activa,
// también con la segunda activa), `activa` null o inexistente (la primera) y `piezasParaMotor`.
import * as transformar from '../src/motor/transformar.js';

const R = transformar.rotacion90('x'); // rotación no simétrica
const buf = () => new Uint8Array([1, 2, 3, 4]).buffer;
const vista = { triangulos: 1, tamano: { x: 1, y: 2, z: 3 } };
const mismo = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Sin pieza: getters con valores iniciales, setters sin efecto, matrizModelo = identidad. */
function sinPieza(e, chequear) {
    const { estado } = e;
    estado.piezas = [];
    estado.activa = null;
    estado.nombre = 'x';
    estado.stl = buf();
    estado.escala = 3;
    chequear(
        estado.nombre === '' && estado.stl === null && estado.vista === null && estado.escala === 1,
        'estado sin pieza: getters con valores iniciales y setters sin efecto',
    );
    chequear(mismo(estado.rotacion, transformar.identidad()), 'estado sin pieza: rotación identidad');
    chequear(mismo(e.matrizModelo(), transformar.identidad()), 'matrizModelo sin pieza: identidad');
}

/** Con piezas: la activa es la segunda, null o un id inexistente. */
function conPiezas(e, chequear) {
    const { estado } = e;
    const a = e.crearPieza({ nombre: 'a.stl', stl: buf(), vista });
    const b = e.crearPieza({ nombre: 'b.stl', stl: buf(), vista, transformacion: { rotacion: R, escala: 2 } });
    chequear(
        a.id !== b.id && a.copias === 1 && a.origen === 'modelo',
        'crearPieza: ids distintos, 1 copia, origen modelo',
    );
    chequear(b.rotacion !== R && mismo(b.rotacion, R), 'crearPieza: no comparte la rotación');
    estado.piezas = [a, b];
    estado.activa = b.id;
    chequear(
        estado.nombre === 'b.stl' && estado.stl === b.stl && estado.escala === 2,
        'segunda activa: los getters leen la segunda',
    );
    const nuevo = {
        nombre: 'u',
        stl: buf(),
        vista: { triangulos: 9 },
        rotacion: transformar.rotacion90('z'),
        escala: 7,
    };
    const antes = JSON.stringify(a);
    Object.assign(estado, nuevo);
    chequear(
        Object.keys(nuevo).every(k => b[k] === nuevo[k]),
        'segunda activa: los cinco setters escriben en la segunda',
    );
    chequear(JSON.stringify(a) === antes, 'segunda activa: la primera pieza no cambia');
    estado.activa = null;
    chequear(e.piezaActiva() === a && estado.nombre === 'a.stl', 'activa null: la primera pieza');
    estado.activa = 9999;
    chequear(e.piezaActiva() === a, 'activa con id inexistente: cae en la primera');
    chequear(mismo(e.matrizModelo(), e.matrizPieza(a)) && e.copiasTotales() === 2, 'matrizModelo y copiasTotales');
    estado.piezas = [];
    chequear(e.crearPieza({ nombre: 'z', stl: buf(), vista }).id > b.id, 'el id sigue creciendo tras piezas = []');
}

/** piezasParaMotor: copia del stl, matriz completa y posiciones copiadas. */
function paraMotor(e, chequear) {
    const q = e.crearPieza({ nombre: 'q', stl: buf(), vista, transformacion: { rotacion: R, escala: 2 } });
    e.estado.piezas = [q, e.crearPieza({ nombre: 'r', stl: buf(), vista })];
    const m = e.piezasParaMotor();
    chequear(m[0].stl !== q.stl && m[0].stl.byteLength === 4, 'piezasParaMotor: stl copiado (buffer distinto)');
    chequear(
        m[0].transformacion.length === 9 &&
            mismo(m[0].transformacion, transformar.multiplicar(transformar.escala(2), R)),
        'piezasParaMotor: matriz de 9 números, escala 2 × rotación no simétrica',
    );
    m[0].posiciones[0].x = 99;
    chequear(q.posiciones[0].x === 0, 'piezasParaMotor: las posiciones se copian');
    e.estado.piezas = [];
}

/**
 * Corre las pruebas de estado.
 * @param {(ok:boolean, texto:string) => void} chequear
 * @param {(ruta:string) => Promise<object>} cargar importa un módulo de src/ con Vite (ssrLoadModule)
 * @returns {Promise<void>}
 */
export async function probarEstado(chequear, cargar) {
    const e = await cargar('/src/ui/estado.js');
    sinPieza(e, chequear);
    conPiezas(e, chequear);
    paraMotor(e, chequear);
}
