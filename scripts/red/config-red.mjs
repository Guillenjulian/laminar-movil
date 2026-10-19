// Pruebas de src/red/config-red.js (ADR 0007, 6.6 y sección 3): validar, describir y guardar por impresora.
import { CENTINELA, espiarConsola, intentar } from './lib/impresora-falsa.mjs';

const ENDER = { tipo: 'octoprint', direccion: 'http://192.168.1.50', claveApi: CENTINELA, imprimir: false };
const KLIPPER = {
    tipo: 'moonraker',
    direccion: 'https://voron.tail1234.ts.net/mainsail',
    claveApi: '',
    imprimir: true,
};

/** Almacén falso en memoria (guarda copias, como IndexedDB). */
function almacenFalso(inicial = {}) {
    const datos = new Map(Object.entries(inicial).map(([k, v]) => [k, structuredClone(v)]));
    const escrituras = [];
    return {
        datos,
        escrituras,
        async leerAjuste(clave) {
            return datos.has(clave) ? structuredClone(datos.get(clave)) : undefined;
        },
        async guardarAjuste(clave, valor) {
            escrituras.push(clave);
            datos.set(clave, structuredClone(valor));
        },
    };
}

function validar(M, revisar, igual) {
    console.log('\nvalidarConfig');
    revisar('CLAVE_AJUSTE es redImpresoras', M.CLAVE_AJUSTE === 'redImpresoras');
    revisar(
        'una config válida vuelve igual',
        igual(M.validarConfig({ ...ENDER }), ENDER),
        JSON.stringify(M.validarConfig({ ...ENDER })),
    );
    const r = M.validarConfig({ ...KLIPPER, direccion: 'HTTP://Octopi.LOCAL/', tipo: 'moonraker' });
    revisar('renormaliza la dirección', r?.direccion === 'http://octopi.local', JSON.stringify(r));
    const malas = [
        ['tipo desconocido', { ...ENDER, tipo: 'duet' }],
        ['sin tipo', { ...ENDER, tipo: undefined }],
        ['dirección inválida', { ...ENDER, direccion: 'javascript:alert(1)' }],
        ['dirección con credenciales', { ...ENDER, direccion: 'http://u:p@192.168.1.50' }],
        ['sin dirección', { ...ENDER, direccion: undefined }],
        ['claveApi numérica', { ...ENDER, claveApi: 12345 }],
        ['claveApi null', { ...ENDER, claveApi: null }],
        ['null', null],
        ['undefined', undefined],
        ['un texto', 'http://192.168.1.50'],
        ['un número', 7],
    ];
    for (const [nombre, crudo] of malas) {
        revisar(`descarta: ${nombre} → null`, M.validarConfig(crudo) === null, JSON.stringify(M.validarConfig(crudo)));
    }
}

function describir(M, revisar, igual) {
    console.log('\ndescribirConfig');
    const entrada = { ...ENDER };
    const d = M.describirConfig(entrada);
    revisar(
        'oculta la clave con ••• y deja el resto igual',
        igual(d, { ...ENDER, claveApi: '•••' }),
        JSON.stringify(d),
    );
    revisar('no contiene la clave en ninguna parte', !JSON.stringify(d).includes(CENTINELA));
    revisar('no modifica la config original', entrada.claveApi === CENTINELA);
    revisar('sin clave queda ""', M.describirConfig({ ...KLIPPER }).claveApi === '');
}

async function ida(M, revisar, igual) {
    console.log('\ncrearRepositorioRed: guardar y leer por impresora');
    const almacen = almacenFalso();
    const repo = M.crearRepositorioRed(almacen);
    revisar('leer de una impresora sin configurar → null', (await repo.leer('creality-ender-3-v3-se')) === null);
    await repo.guardar('creality-ender-3-v3-se', { ...ENDER });
    revisar('ida y vuelta de la config', igual(await repo.leer('creality-ender-3-v3-se'), ENDER));
    const guardado = almacen.datos.get('redImpresoras');
    revisar(
        'queda en la clave redImpresoras, version 1, por impresoraId',
        igual(guardado, { version: 1, porImpresora: { 'creality-ender-3-v3-se': ENDER } }),
        JSON.stringify(guardado),
    );
    await repo.guardar('propio-123', { ...KLIPPER });
    revisar(
        'dos impresoras no se pisan',
        igual(await repo.leer('creality-ender-3-v3-se'), ENDER) && igual(await repo.leer('propio-123'), KLIPPER),
    );
    revisar('otra impresora sigue sin configurar', (await repo.leer('prusa-mk4')) === null);
    const nueva = { ...ENDER, direccion: 'http://192.168.1.77', imprimir: true };
    await repo.guardar('creality-ender-3-v3-se', nueva);
    revisar(
        'guardar de nuevo reemplaza sólo esa impresora',
        igual(await repo.leer('creality-ender-3-v3-se'), nueva) && igual(await repo.leer('propio-123'), KLIPPER),
    );
    await repo.borrar('creality-ender-3-v3-se');
    revisar('borrar quita esa impresora', (await repo.leer('creality-ender-3-v3-se')) === null);
    revisar('borrar no toca las otras', igual(await repo.leer('propio-123'), KLIPPER));
    revisar('borrar deja la version 1', almacen.datos.get('redImpresoras')?.version === 1);
    await repo.borrar('no-existe');
    revisar('borrar una que no existe no rompe nada', igual(await repo.leer('propio-123'), KLIPPER));
    revisar(
        'sólo escribe la clave redImpresoras',
        almacen.escrituras.every(k => k === 'redImpresoras'),
    );
}

async function corrupto(M, revisar) {
    console.log('\ncrearRepositorioRed: datos corruptos → null, sin excepción');
    const casos = [
        ['un texto', 'basura'],
        ['null', null],
        ['version distinta', { version: 2, porImpresora: { x: ENDER } }],
        ['porImpresora no es objeto', { version: 1, porImpresora: 5 }],
        ['sin porImpresora', { version: 1 }],
        ['entrada con tipo inválido', { version: 1, porImpresora: { x: { ...ENDER, tipo: 'otro' } } }],
        ['entrada con dirección inválida', { version: 1, porImpresora: { x: { ...ENDER, direccion: 'ftp://x' } } }],
        ['entrada que no es objeto', { version: 1, porImpresora: { x: 'hola' } }],
    ];
    for (const [nombre, valor] of casos) {
        const repo = M.crearRepositorioRed(almacenFalso({ redImpresoras: valor }));
        const r = await intentar(() => repo.leer('x'));
        revisar(`${nombre}`, !r.lanzo && r.valor === null, r.lanzo ? r.error.message : JSON.stringify(r.valor));
    }
    const mezcla = M.crearRepositorioRed(
        almacenFalso({ redImpresoras: { version: 1, porImpresora: { buena: ENDER, mala: { ...ENDER, tipo: 'x' } } } }),
    );
    revisar(
        'una entrada mala no tira las buenas',
        (await mezcla.leer('mala')) === null && (await mezcla.leer('buena'))?.direccion === ENDER.direccion,
    );
}

async function secreto(M, revisar) {
    console.log('\nR3: la clave no sale por console');
    const espia = espiarConsola();
    const repo = M.crearRepositorioRed(almacenFalso());
    await repo.guardar('a', { ...ENDER });
    await repo.leer('a');
    M.describirConfig({ ...ENDER });
    M.validarConfig({ ...ENDER, tipo: 'malo' });
    await repo.borrar('a');
    const llamadas = espia.restaurar();
    revisar('ninguna función escribe en console', llamadas.length === 0, JSON.stringify(llamadas).slice(0, 200));
}

export default async function ({ revisar, igual, cargar }) {
    const M = await cargar('config-red');
    if (!M) return;
    validar(M, revisar, igual);
    describir(M, revisar, igual);
    await ida(M, revisar, igual);
    await corrupto(M, revisar);
    await secreto(M, revisar);
}
