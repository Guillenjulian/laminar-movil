// Pruebas de los accesores de `estado.piezas` (ADR 0003, T7) en Node, sin navegador ni DOM.
// Se llama desde probar-contratos.mjs (`npm run test:contratos`), que pasa el cargador de Vite porque
// estado.js importa JSON de perfiles y Node solo no lo resuelve.
// Cubre: sin pieza (valores iniciales, el setter no hace nada), con pieza (lee y escribe en la activa),
// `activa` null (la primera) y `piezasParaMotor` (copia del stl y matriz de 9 números).
import * as transformar from '../src/motor/transformar.js';

/**
 * Corre las pruebas de estado.
 * @param {(ok:boolean, texto:string) => void} chequear
 * @param {(ruta:string) => Promise<object>} cargar importa un módulo de src/ con Vite (ssrLoadModule)
 * @returns {Promise<void>}
 */
export async function probarEstado(chequear, cargar) {
    const e = await cargar('/src/ui/estado.js');
    const { estado } = e;
    const buf = () => new Uint8Array([1, 2, 3, 4]).buffer;
    const vista = { triangulos: 1, tamano: { x: 1, y: 2, z: 3 } };
    const mismo = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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

    const a = e.crearPieza({ nombre: 'a.stl', stl: buf(), vista });
    const conEscala = { rotacion: transformar.identidad(), escala: 2 };
    const b = e.crearPieza({ nombre: 'b.stl', stl: buf(), vista, transformacion: conEscala });
    chequear(
        a.id !== b.id && a.copias === 1 && a.origen === 'modelo',
        'crearPieza: ids distintos, 1 copia, origen modelo',
    );
    estado.piezas = [a, b];
    estado.activa = b.id;
    chequear(estado.nombre === 'b.stl' && estado.escala === 2, 'con pieza: los getters leen la activa');
    estado.escala = 5;
    estado.nombre = 'c.stl';
    chequear(b.escala === 5 && b.nombre === 'c.stl' && a.escala === 1, 'con pieza: los setters escriben en la activa');
    estado.activa = null;
    chequear(e.piezaActiva() === a && estado.nombre === 'a.stl', 'activa null: la primera pieza');
    chequear(mismo(e.matrizModelo(), e.matrizPieza(a)) && e.copiasTotales() === 2, 'matrizModelo y copiasTotales');

    const m = e.piezasParaMotor();
    chequear(
        m.length === 2 && m[0].stl !== a.stl && m[0].stl.byteLength === 4 && m[0].transformacion.length === 9,
        'piezasParaMotor: stl copiado (buffer distinto) y matriz de 9 números',
    );
    chequear(m[1].transformacion[0] === 5, 'piezasParaMotor: la escala va en la matriz');
    estado.piezas = [];
}
