// Pruebas de armarConfiguracion con `cambios` (ADR 0002, T2). Corren en Node, sin navegador.
// perfiles.js usa import.meta.glob de Vite: se carga con el servidor de Vite en memoria.

import assert from 'node:assert/strict';
import { createServer } from 'vite';

const MATERIALES = ['pla', 'petg', 'tpu', 'abs'];
const PERSONALES = [{}, { avanzado: { jarron: true } }, { avanzado: { tempBoquilla: 400 } }];
const CALIDADES = ['rapido', 'normal', 'detalle'];

/**
 * Corre las pruebas de configuración con cambios.
 * @param {(nombre: string, condicion: boolean, detalle?: string) => void} revisar registra un resultado
 * @returns {Promise<void>}
 */
export async function probarConfiguracionCambios(revisar) {
    console.log('\n▶ armarConfiguracion con cambios (ADR 0002, T2)');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
    try {
        const modulo = await vite.ssrLoadModule('/src/perfiles/perfiles.js');
        probarRegresion(revisar, modulo);
        probarRangos(revisar, modulo);
        probarRecorte(revisar, modulo);
        probarAlturaVariableYJarron(revisar, modulo);
    } finally {
        await vite.close();
    }
}

const ENDER = { impresoraId: 'creality-ender-3-v3-se', calidad: 'normal', material: 'pla' };
const cuentaBoquilla = r => r.avisos.filter(a => a.startsWith('La boquilla se limitó')).length;

// Sin cambios, con [] y con undefined la salida es la misma, avisos incluidos.
function probarRegresion(revisar, { armarConfiguracion, listaImpresoras }) {
    {
        const impresoras = listaImpresoras();
        let regresion = true;
        let combinaciones = 0;
        for (const { id } of impresoras) {
            for (const calidad of CALIDADES) {
                for (const material of MATERIALES) {
                    for (const personal of PERSONALES) {
                        const base = { impresoraId: id, calidad, material, soportes: true, personal };
                        const esperado = armarConfiguracion(base);
                        combinaciones++;
                        try {
                            assert.deepStrictEqual(armarConfiguracion({ ...base, cambios: [] }), esperado);
                            assert.deepStrictEqual(armarConfiguracion({ ...base, cambios: undefined }), esperado);
                            assert.ok(!('ranges' in esperado.proceso));
                        } catch (e) {
                            regresion = false;
                            console.log(`    ${id} ${calidad} ${material}: ${e.message.split('\n')[0]}`);
                        }
                    }
                }
            }
        }
        revisar(
            `regresión: sin cambios, [] y undefined dan lo mismo (${combinaciones} combinaciones, avisos incluidos)`,
            regresion,
        );
    }
}

function probarRangos(revisar, { armarConfiguracion }) {
    {
        const pBase = armarConfiguracion(ENDER);
        const conCambios = armarConfiguracion({
            ...ENDER,
            cambios: [{ desdeMm: 10, relleno: 0.1, tempBoquilla: 215, velocidad: 80, ventilador: 50 }],
        });
        const rg = conCambios.proceso.ranges;
        revisar(
            'ranges: capas, campos y escalado de velocidad',
            rg?.length === 1 &&
                rg[0].lo === 50 &&
                rg[0].hi === 1e9 &&
                rg[0].fields.sliceFillSparse === 0.1 &&
                rg[0].fields.outputTemp === 215 &&
                rg[0].fields.outputFanSpeed === 128 &&
                rg[0].fields.outputFeedrate === Math.round(pBase.proceso.outputFeedrate * 0.8),
            JSON.stringify(rg),
        );
        const { ranges: _r, ...sinRanges } = conCambios.proceso;
        revisar(
            'el resto del proceso y los avisos no cambian',
            JSON.stringify(sinRanges) === JSON.stringify(pBase.proceso) &&
                JSON.stringify(conCambios.avisos) === JSON.stringify(pBase.avisos),
        );
    }
}

function probarRecorte(revisar, { armarConfiguracion, listaImpresoras }) {
    {
        const hotendMax = listaImpresoras().find(i => i.id === ENDER.impresoraId).limites.hotendMax;
        const caliente = armarConfiguracion({ ...ENDER, cambios: [{ desdeMm: 5, tempBoquilla: 300 }] });
        revisar(
            'temperatura del rango se recorta a hotendMax con un aviso',
            caliente.proceso.ranges[0].fields.outputTemp === hotendMax && cuentaBoquilla(caliente) === 1,
            `hotendMax ${hotendMax}`,
        );
        const triple = armarConfiguracion({
            ...ENDER,
            personal: { avanzado: { tempBoquilla: 400 } },
            cambios: [
                { desdeMm: 5, hastaMm: 10, tempBoquilla: 300 },
                { desdeMm: 10, tempBoquilla: 290 },
            ],
        });
        revisar(
            'recorte en la base y en 2 rangos: exactamente 1 aviso de boquilla',
            cuentaBoquilla(triple) === 1 &&
                triple.proceso.outputTemp === hotendMax &&
                triple.proceso.ranges.every(r => r.fields.outputTemp === hotendMax),
            JSON.stringify(triple.avisos),
        );
    }
}

function probarAlturaVariableYJarron(revisar, { armarConfiguracion }) {
    {
        const variable = armarConfiguracion({
            ...ENDER,
            personal: { avanzado: { alturaVariable: true } },
            cambios: [{ desdeMm: 5, tempBoquilla: 210 }],
        });
        revisar(
            'altura variable: sin ranges y con aviso',
            !('ranges' in variable.proceso) && variable.avisos.some(a => a.includes('altura de capa variable')),
        );
        const jarron = armarConfiguracion({
            ...ENDER,
            personal: { avanzado: { jarron: true } },
            cambios: [
                { desdeMm: 5, relleno: 0.3, tempBoquilla: 210 },
                { desdeMm: 20, relleno: 0.5 },
            ],
        });
        revisar(
            'jarrón: se descarta el relleno (sin claves undefined) y el cambio vacío, con aviso',
            jarron.proceso.ranges.length === 1 &&
                jarron.proceso.ranges[0].lo === 25 &&
                JSON.stringify(jarron.proceso.ranges[0].fields) === '{"outputTemp":210}' &&
                Object.keys(jarron.proceso.ranges[0].fields).length === 1 &&
                jarron.avisos.some(a => a.includes('jarrón')),
            JSON.stringify(jarron.proceso.ranges),
        );
        const malos = armarConfiguracion({ ...ENDER, cambios: [{ desdeMm: 0, relleno: 1 }] });
        revisar(
            'cambios inválidos: aviso de validación y sin ranges',
            !('ranges' in malos.proceso) && malos.avisos.length === 1,
        );
    }
}
