// Pruebas de los accesores de `estado.piezas` (ADR 0003, T7) en Node, sin navegador ni DOM.
// Se llama desde probar-contratos.mjs (`npm run test:contratos`), que pasa el cargador de Vite porque
// estado.js importa JSON de perfiles y Node solo no lo resuelve.
// Cubre: sin pieza (valores iniciales, el setter no hace nada), con pieza (lee y escribe en la activa,
// también con la segunda activa), `activa` null o inexistente (la primera) y `piezasParaMotor`.
import assert from 'node:assert/strict';
import * as transformar from '../src/motor/transformar.js';

const R = transformar.rotacion90('x'); // rotación no simétrica
const buf = () => new Uint8Array([1, 2, 3, 4]).buffer;
const vista = { triangulos: 1, tamano: { x: 1, y: 2, z: 3 } };
const mismo = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Igualdad profunda sin importar el orden de las claves. */
const igual = (a, b) => {
    try {
        assert.deepStrictEqual(a, b);
        return true;
    } catch {
        return false;
    }
};

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

/** Zonas sin soporte (ADR 0004): `crearPieza` las trae vacías, `piezasParaMotor` las copia en profundidad. */
function bloqueos(e, chequear) {
    const q = e.crearPieza({ nombre: 'q', stl: buf(), vista });
    chequear(
        Array.isArray(q.bloqueos) && q.bloqueos.length === 0 && q.firmaBloqueos === null,
        'crearPieza: bloqueos [] y firmaBloqueos null',
    );
    chequear(e.estado.ultimoIdBloqueo === 0 && e.estado.soportes === 'no', 'estado: ultimoIdBloqueo 0 y soportes "no"');
    q.bloqueos.push({ id: 1, forma: 'esfera', centro: { x: 1, y: 2, z: 3 }, radio: 5 });
    e.estado.piezas = [q];
    const m = e.piezasParaMotor();
    chequear(mismo(m[0].bloqueos, q.bloqueos), 'piezasParaMotor: lleva los bloqueos de la pieza');
    m[0].bloqueos[0].centro.x = 99;
    m[0].bloqueos[0].radio = 40;
    chequear(q.bloqueos[0].centro.x === 1 && q.bloqueos[0].radio === 5, 'piezasParaMotor: bloqueos en copia profunda');
    q.bloqueos = undefined;
    chequear(mismo(e.piezasParaMotor()[0].bloqueos, []), 'piezasParaMotor: una pieza sin bloqueos manda []');
    e.estado.piezas = [];
}

/** `armarConfiguracion` con el tipo: true y 'normal' dan exactamente el proceso de siempre con true (ADR 0004). */
function configuracionSoportes(p, chequear) {
    for (const impresoraId of ['creality-ender-3-v3-se', 'prusa-mk4', 'bambu-lab-a1']) {
        for (const calidad of ['normal', 'rapida']) {
            const base = { impresoraId, calidad, personal: {} };
            const sin = p.armarConfiguracion({ ...base, soportes: false }).proceso;
            const hoy = { ...sin, sliceSupportType: 'automatic' }; // lo que armaba la app con `true`
            const mismoProceso = (tipo, esperado) =>
                igual(p.armarConfiguracion({ ...base, soportes: tipo }).proceso, esperado);
            const donde = `${impresoraId}/${calidad}`;
            chequear(
                mismoProceso(true, hoy) && mismoProceso('normal', hoy),
                `soportes true y 'normal' = proceso de hoy (${donde})`,
            );
            chequear(
                mismoProceso('no', sin) && mismoProceso(undefined, sin),
                `soportes false y 'no' = sin soportes (${donde})`,
            );
            chequear(
                mismoProceso('arbol', { ...hoy, sliceSupportTree: true }),
                `soportes 'arbol' suma sliceSupportTree (${donde})`,
            );
        }
    }
}

/** Pieza cúbica de `lado` mm (escala opcional) para las pruebas de acomodo. */
function cubo(e, lado, escala = 1) {
    return e.crearPieza({
        nombre: 'c',
        stl: buf(),
        vista: { triangulos: 12, tamano: { x: lado, y: lado, z: lado } },
        transformacion: { rotacion: transformar.identidad(), escala },
    });
}

/** acomodarPiezas: cubos de 20 mm en la Ender 3 V3 SE (cama 220 × 220, separación 10 mm), valores exactos. */
function acomodo(e, a, chequear) {
    const { estado } = e;
    estado.impresoraId = 'creality-ender-3-v3-se';
    estado.piezas = [cubo(e, 20)];
    const uno = a.acomodarPiezas();
    chequear(
        uno.entra && uno.fuera.length === 0 && estado.entra && mismo(estado.piezas[0].posiciones, [{ x: 0, y: 0 }]),
        'acomodarPiezas: 1 pieza da [{0,0}] y entra',
    );
    const dos = cubo(e, 20);
    estado.piezas = [cubo(e, 20), dos];
    chequear(
        a.acomodarPiezas().entra &&
            mismo(estado.piezas[0].posiciones, [{ x: -15, y: 0 }]) &&
            mismo(dos.posiciones, [{ x: 15, y: 0 }]),
        'acomodarPiezas: 2 cubos de 20 mm en 220: centros (-15, 0) y (15, 0)',
    );
    estado.piezas = [cubo(e, 20, 2), cubo(e, 20, 2)];
    chequear(
        a.acomodarPiezas().entra && mismo(estado.piezas[1].posiciones, [{ x: 25, y: 0 }]),
        'acomodarPiezas: con escala 2 (40 mm) sigue entrando, centros (-25, 0) y (25, 0)',
    );
    acomodoCopias(e, a, chequear);
    acomodoCama(e, a, chequear);
    acomodoMedir(e, a, chequear);
}

/** acomodarPiezas: copias, lo que no entra y el caso sin piezas. */
function acomodoCopias(e, a, chequear) {
    const { estado } = e;
    const copias = cubo(e, 20);
    copias.copias = 3;
    estado.piezas = [copias];
    chequear(
        a.acomodarPiezas().entra &&
            mismo(copias.posiciones, [
                { x: -30, y: 0 },
                { x: 0, y: 0 },
                { x: 30, y: 0 },
            ]),
        'acomodarPiezas: 3 copias de una pieza: una posición por copia',
    );
    estado.piezas = [cubo(e, 200), cubo(e, 200)];
    const grande = a.acomodarPiezas();
    chequear(
        !grande.entra && !estado.entra && mismo(grande.fuera, [1]),
        'acomodarPiezas: 200 mm más 200 mm no entra en 220 (fuera exacto: [1], dio ' + grande.fuera + ')',
    );
    const chica = cubo(e, 20);
    chica.copias = 2;
    estado.piezas = [chica, cubo(e, 200)];
    chequear(
        mismo(a.acomodarPiezas().fuera, [0, 1]),
        'acomodarPiezas: 2 copias de 20 mm y un cubo de 200: fuera son los índices globales [0, 1]',
    );
    estado.piezas = [];
    chequear(a.acomodarPiezas().entra && estado.entra, 'acomodarPiezas: sin piezas entra');
}

/** Pieza con caja `x × y × z` (mm) y rotación `rot` opcional. */
function caja(e, x, y, z, rot = transformar.identidad()) {
    return e.crearPieza({
        nombre: 'k',
        stl: buf(),
        vista: { triangulos: 12, tamano: { x, y, z } },
        transformacion: { rotacion: rot, escala: 1 },
    });
}

/** acomodarPiezas: cama rectangular (Prusa MK4, 250 × 210 × 220) y pieza más alta que la impresora. */
function acomodoCama(e, a, chequear) {
    const { estado } = e;
    estado.impresoraId = 'prusa-mk4';
    estado.piezas = [caja(e, 230, 200, 10)];
    chequear(a.acomodarPiezas().entra, 'acomodarPiezas: 230 × 200 entra en la MK4 (250 × 210) en ese sentido');
    estado.piezas = [caja(e, 230, 200, 10, transformar.rotacion90('z'))];
    chequear(
        mismo(a.acomodarPiezas().fuera, [0]),
        'acomodarPiezas: la misma pieza girada 90° (200 × 230) no entra en la MK4',
    );
    estado.piezas = [caja(e, 20, 20, 230)];
    const alta = a.acomodarPiezas();
    chequear(
        !alta.entra && mismo(alta.fuera, [0]),
        'acomodarPiezas: una pieza más alta que maxHeight (220) cae en fuera',
    );
    estado.impresoraId = 'creality-ender-3-v3-se';
}

/** acomodarPiezas: `medir` inyectado (huella exacta) o ausente (caja de 8 esquinas, conservadora), giro de 45°. */
function acomodoMedir(e, a, chequear) {
    const { estado } = e;
    const c = Math.SQRT1_2;
    const rot45 = [c, -c, 0, c, c, 0, 0, 0, 1];
    const cerca = (p, x) => Math.abs(Math.abs(p.posiciones[0].x) - x) < 1e-9 && p.posiciones[0].y === 0;
    const dos = [caja(e, 20, 20, 20, rot45), caja(e, 20, 20, 20, rot45)];
    estado.piezas = dos;
    const real = a.acomodarPiezas(() => ({ x: 20, y: 20, z: 20 }));
    chequear(
        real.entra && cerca(dos[0], 15) && cerca(dos[1], 15),
        'acomodarPiezas(medir): con la huella real (20 mm) los centros son ±15',
    );
    a.acomodarPiezas();
    const lado = 20 * Math.SQRT2;
    chequear(
        cerca(dos[0], (lado + 10) / 2) && cerca(dos[1], (lado + 10) / 2),
        'acomodarPiezas sin medir: usa la caja de 8 esquinas girada 45° (28,28 mm), centros ±19,14',
    );
    estado.piezas = [];
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
    bloqueos(e, chequear);
    configuracionSoportes(await cargar('/src/perfiles/perfiles.js'), chequear);
    acomodo(e, await cargar('/src/ui/acomodo.js'), chequear);
}
