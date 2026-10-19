// Pruebas de src/ui/entrega.js (ADR 0005, T5) en Node: nombre, MIME y archivo armado con y sin pausas.

import JSZip from 'jszip';
import { ENTRADAS } from '../../src/motor/bambu-3mf.js';
import { insertarPausas } from '../../src/motor/pausas.js';
import { armarEntrega, mimeEntrega, nombreEntrega } from '../../src/ui/entrega.js';

const gcode = ';LAYER:0\nG1 X1 Y1 E0.5 ; ñandú\n;LAYER:1\nG1 X2 Y2 E0.5\n;LAYER:2\nG1 X3 Y3 E0.5\n';
const resultado = { gcode, archivo: 'cubo_rapido.gcode', info: {} };
const pausas = [{ capa: 1, offset: gcode.indexOf(';LAYER:1'), z: 0.4 }];
const infoBambu = {
    nombre: 'cubo_rapido',
    tiempo: 600,
    gramos: 2,
    modelo: { id: 'N2S' },
    filamento: { tipo: 'PLA', color: '#FFFFFF', trayInfoIdx: 'GFL99' },
};
const modelo = { id: 'N2S', nombre: 'P1S' };
const salidaPlana = { formato: 'gcode', pausa: ['M600'] };
const salida3mf = { formato: 'gcode.3mf', pausa: ['M400 U1'], modelo };
const mensaje = fn =>
    fn().then(
        () => null,
        e => e.message,
    );

function probarNombreYMime({ revisar }) {
    const n = nombreEntrega;
    revisar('entrega: gcode.3mf cambia la extensión', n('cubo_rapido.gcode', 'gcode.3mf') === 'cubo_rapido.gcode.3mf');
    revisar('entrega: gcode deja el nombre', n('cubo_rapido.gcode', 'gcode') === 'cubo_rapido.gcode');
    revisar('entrega: sin extensión + gcode', n('cubo', 'gcode') === 'cubo.gcode');
    revisar('entrega: sin extensión + gcode.3mf', n('cubo', 'gcode.3mf') === 'cubo.gcode.3mf');
    revisar(
        'entrega: gcode en el medio es parte del nombre',
        n('mi.gcode.v2', 'gcode.3mf') === 'mi.gcode.v2.gcode.3mf',
    );
    revisar('entrega: ya con .gcode.3mf no se duplica', n('a.gcode.3mf', 'gcode.3mf') === 'a.gcode.3mf');
    revisar('entrega: mime gcode = text/plain', mimeEntrega('gcode') === 'text/plain');
    revisar('entrega: mime 3mf = octet-stream', mimeEntrega('gcode.3mf') === 'application/octet-stream');
}

async function probarGcodePlano({ revisar }) {
    const f = await armarEntrega(resultado, pausas, salidaPlana);
    const esperado = insertarPausas(gcode, pausas, ['M600']);
    revisar('entrega gcode: texto = insertarPausas', (await f.text()) === esperado && esperado !== gcode);
    revisar('entrega gcode: nombre y type', f.name === 'cubo_rapido.gcode' && f.type === 'text/plain', f.type);
    const sin = await armarEntrega(resultado, [], salidaPlana);
    revisar('entrega gcode: sin pausas = G-code original', (await sin.text()) === gcode);
}

async function probar3mf({ revisar }) {
    const avances = [];
    const f = await armarEntrega(resultado, pausas, salida3mf, infoBambu, x => avances.push(x));
    revisar('entrega 3mf: nombre y type', f.name === 'cubo_rapido.gcode.3mf' && f.type === 'application/octet-stream');
    const zip = await JSZip.loadAsync(await f.arrayBuffer());
    const adentro = await zip.file(ENTRADAS.gcode).async('string');
    revisar('entrega 3mf: plate_1.gcode = G-code con pausas', adentro === insertarPausas(gcode, pausas, ['M400 U1']));
    revisar('entrega 3mf: tiene M400 U1', adentro.includes('M400 U1'));
    revisar('entrega 3mf: alProgreso llegó', avances.length > 0 && avances.at(-1) === 1, `${avances.length} avisos`);
}

async function probarErrores({ revisar }) {
    const sinInfo = await mensaje(() => armarEntrega(resultado, pausas, salida3mf));
    revisar('entrega 3mf: sin infoBambu falla claro', /Bambu/.test(sinInfo ?? ''), sinInfo);
    const sinModelo = await mensaje(() =>
        armarEntrega(resultado, pausas, { ...salida3mf, modelo: undefined }, infoBambu),
    );
    revisar('entrega 3mf: sin modelo falla claro', /Bambu/.test(sinModelo ?? ''), sinModelo);
}

export async function probarEntrega({ revisar }) {
    probarNombreYMime({ revisar });
    await probarGcodePlano({ revisar });
    await probar3mf({ revisar });
    await probarErrores({ revisar });
}
