// Prueba de punta a punta de la app, emulando un celu (Pixel 7, pantalla táctil).
// Recorre los 4 pasos, prueba cancelar, el botón "atrás" y la descarga, y
// guarda capturas en capturas/ (o en la carpeta de CAPTURAS).
//
// Es un solo recorrido con estado: cada área de scripts/app/ deja la app como la necesita la
// siguiente (la precondición y el estado final están en la cabecera de cada archivo), así que el
// orden de abajo importa. El arranque (servidor, Chromium, `ok`) está en scripts/lib/app.mjs.
//
// Uso: npm run build && npm run test:app

import { iniciarApp } from './lib/app.mjs';
import { probarModelo, probarGestos } from './app/paso1-modelo.mjs';
import { probarFormatos } from './app/paso1-formatos.mjs';
import { probarPiezas } from './app/piezas.mjs';
import { probarCopias } from './app/copias.mjs';
import { probarConfig } from './app/paso2-config.mjs';
import { probarCancelar, probarPersonalizar, probarLaminarCubo } from './app/paso3-laminar.mjs';
import { probarMateriales } from './app/materiales.mjs';
import { probarAvanzado } from './app/avanzado.mjs';
import { probarCambios } from './app/cambios.mjs';
import { probarCambiosGcode } from './app/cambios-gcode.mjs';
import { probarVistaCapas } from './app/vista-capas.mjs';
import { probarPausas } from './app/pausas.mjs';
import { probarDescarga } from './app/descarga.mjs';
import { probarDescargaBambu } from './app/descarga-bambu.mjs';
import { probarImpresoras } from './app/impresoras.mjs';
import { probarRecientes } from './app/recientes.mjs';
import { probarTransformar } from './app/transformar.mjs';
import { probarTorres } from './app/torres.mjs';
import { probarVisorDiferido } from './app/visor-diferido.mjs';
import { probarOffline } from './app/offline.mjs';
import { probarAcomodoConGiros, probarPrecioTrasRecargar } from './app/piezas-extra.mjs';

const AREAS = [
    probarModelo,
    probarFormatos,
    probarGestos,
    probarPiezas,
    probarCopias,
    probarAcomodoConGiros,
    probarConfig,
    probarCancelar,
    probarPersonalizar,
    probarLaminarCubo,
    probarMateriales,
    probarAvanzado,
    probarCambios,
    probarVistaCapas,
    probarPausas,
    probarDescarga,
    probarDescargaBambu,
    probarCambiosGcode,
    probarImpresoras,
    probarRecientes,
    probarTransformar,
    probarTorres,
    probarPrecioTrasRecargar,
    probarVisorDiferido,
    probarOffline,
];

const ctx = await iniciarApp();
try {
    for (const area of AREAS) await area(ctx);
} finally {
    await ctx.cerrar();
}
process.exit(ctx.terminar());
