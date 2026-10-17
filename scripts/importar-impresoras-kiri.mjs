// Convierte los perfiles de impresoras FDM de Kiri:Moto a nuestro formato y los
// guarda en src/perfiles/impresoras/kiri/ marcados como "importado" (sin revisar).
//
// Uso:
//   npm run importar:impresoras                      -> usa el clon de grid-apps de vendor:kiri
//   npm run importar:impresoras -- /ruta/grid-apps
//
// Las impresoras revisadas a mano viven aparte (src/perfiles/impresoras/*.json)
// y este script no las toca.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { generarCalidades } from '../src/perfiles/generico.js';

// Kiri usa `self` (de los workers) al cargar sus módulos.
globalThis.self = globalThis;
await import('../vendor/kiri/src/add/class.js');
const { conf } = await import('../vendor/kiri/src/kiri/app/conf/defaults.js');

const RAIZ = path.resolve(import.meta.dirname, '..');
const DESTINO = path.join(RAIZ, 'src', 'perfiles', 'impresoras', 'kiri');

let origen = process.argv[2] || path.join(RAIZ, 'node_modules', '.cache', 'grid-apps');
if (!fs.existsSync(origen)) {
    execSync(`git clone --depth 1 https://github.com/GridSpace/grid-apps.git "${origen}"`, { stdio: 'inherit' });
}
const CARPETA = path.join(origen, 'src', 'kiri', 'dev', 'fdm');
const version = JSON.parse(fs.readFileSync(path.join(origen, 'package.json'))).version;

// Impresoras que no importamos y por qué.
const EXCLUIDAS = {
    'Bambu.A1': 'Bambu Lab espera archivos .gcode.3mf, no G-code plano',
    'Bambu.P1S': 'Bambu Lab espera archivos .gcode.3mf, no G-code plano',
    'taz.lulzbot.747': 'su G-code es de otro modelo (LulzBot Sidekick, copiado de Cura) y tiene temperaturas fijas',
    'Makerbot.Replicator2': 'usa G-code propio de Makerbot (y en la práctica archivos .x3g)',
    'Any.Generic.Marlin': 'plantilla con cama genérica de Kiri (para eso está "Mi impresora")',
    'Any.Generic.Klipper': 'plantilla con cama genérica de Kiri (para eso está "Mi impresora")',
};

// Nombres que vienen raros en Kiri.
const NOMBRES = {
    'Creality.Ender.7': 'Creality Ender 7',
    'Snapmaker.U1': 'Snapmaker U1',
};

// Avisos conocidos que se muestran al elegir la impresora.
const AVISOS = {
    'Creality.Ender.3': 'El G-code de inicio trae G80 (mallado de Prusa), que la Ender 3 no usa. Revisalo antes de imprimir.',
};

// Del proceso de Kiri sacamos lo que ya deciden la calidad, el material y las
// opciones de la app; nos quedamos con lo propio de la máquina (velocidades,
// retracción, multiplicadores de extrusión...).
const DE_LA_APP = /^(processName|sliceHeight|firstSliceHeight|sliceShells|sliceTopLayers|sliceBottomLayers|sliceFillSparse|sliceFillType|outputTemp|outputBedTemp|firstLayerNozzleTemp|firstLayerBedTemp|outputFanSpeed|firstLayerFanSpeed|sliceSupport.*|outputBrim.*|outputRaft.*|firstLayerBrim.*|ranges)$/;

// Claves del dispositivo que usamos.
const DISPOSITIVO = ['deviceName', 'bedWidth', 'bedDepth', 'maxHeight', 'originCenter', 'bedRound', 'fwRetract',
    'extrudeAbs', 'deviceZMax', 'gcodeTime', 'gcodePre', 'gcodePost', 'gcodeFan', 'gcodeTrack', 'gcodeLayer', 'gcodeFExt'];

const slug = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

fs.rmSync(DESTINO, { recursive: true, force: true });
fs.mkdirSync(DESTINO, { recursive: true });

const importadas = [], salteadas = [];
for (const archivo of fs.readdirSync(CARPETA).filter(f => f.endsWith('.json')).sort()) {
    const base = archivo.replace(/\.json$/, '');
    if (EXCLUIDAS[base]) {
        salteadas.push(`${base}: ${EXCLUIDAS[base]}`);
        continue;
    }
    // device_from_code convierte también el formato viejo de Kiri.
    const d = conf.device_from_code(JSON.parse(fs.readFileSync(path.join(CARPETA, archivo))), 'FDM');
    if (d.bedBelt) {
        salteadas.push(`${base}: impresora de cinta`);
        continue;
    }
    const nombre = NOMBRES[base] || d.deviceName || base.replace(/[._]/g, ' ');
    const marca = base.split('.')[0];

    const dispositivo = {};
    for (const k of DISPOSITIVO) if (d[k] !== undefined) dispositivo[k] = d[k];
    dispositivo.deviceName = nombre;
    // Sólo el primer extrusor: la app no maneja multi-material.
    dispositivo.extruders = [{ extOffsetX: 0, extOffsetY: 0, ...d.extruders[0] }];
    const notas = [];
    if (!dispositivo.gcodeFan?.length) {
        dispositivo.gcodeFan = ['M106 S{fan_speed}'];
        notas.push('se agregó gcodeFan (sin esto Kiri nunca prende el ventilador)');
    }
    if (!dispositivo.gcodeLayer?.length) dispositivo.gcodeLayer = [';LAYER:{layer}'];
    if (!dispositivo.gcodeFExt) dispositivo.gcodeFExt = 'gcode';

    // Si el inicio no usa las temperaturas elegidas, lo avisamos.
    const inicio = (dispositivo.gcodePre || []).join('\n');
    const sinTemp = [!inicio.includes('{temp}') && 'boquilla', !inicio.includes('{bed_temp}') && 'cama'].filter(Boolean);
    const avisos = [AVISOS[base], sinTemp.length &&
        `El G-code de inicio no usa la temperatura elegida de ${sinTemp.join(' ni de ')} (tiene valores fijos o ninguno).`]
        .filter(Boolean);

    const perfil = (d.profiles || [])[0] || {};
    const proceso = Object.fromEntries(Object.entries(perfil).filter(([k]) => !DE_LA_APP.test(k)));
    const boquilla = dispositivo.extruders[0].extNozzle || 0.4;

    const salida = {
        _nota: `Importado de Kiri:Moto ${version} (src/kiri/dev/fdm/${archivo}) por scripts/importar-impresoras-kiri.mjs. ` +
            `Sin revisar: contrastar con el perfil oficial antes de confiar.${notas.length ? ' Cambios: ' + notas.join('; ') + '.' : ''}`,
        id: 'kiri-' + slug(base),
        nombre,
        marca,
        estado: 'importado',
        ...(avisos.length ? { aviso: avisos.join(' ') } : {}),
        adhesion: 'falda',
        limites: {},
        dispositivo,
        proceso,
        calidades: generarCalidades(boquilla, perfil.outputFeedrate || 50, perfil.outputFinishrate),
    };
    fs.writeFileSync(path.join(DESTINO, salida.id + '.json'), JSON.stringify(salida, null, 4) + '\n');
    importadas.push(nombre);
}

console.log(`Importadas ${importadas.length} impresoras de Kiri:Moto ${version} en src/perfiles/impresoras/kiri/`);
if (salteadas.length) console.log('Salteadas:\n  ' + salteadas.join('\n  '));
