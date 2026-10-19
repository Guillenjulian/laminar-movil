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
import { probarContraste, probarAccesibilidadPasos } from './app/accesibilidad.mjs';
import { probarCancelar, probarPersonalizar, probarLaminarCubo } from './app/paso3-laminar.mjs';
import { probarMateriales } from './app/materiales.mjs';
import { probarAvanzado } from './app/avanzado.mjs';
import { probarCambios } from './app/cambios.mjs';
import { probarCambiosGcode } from './app/cambios-gcode.mjs';
import { probarVistaCapas } from './app/vista-capas.mjs';
import { probarPausas } from './app/pausas.mjs';
import { probarDescarga } from './app/descarga.mjs';
import { probarDescargaBambu } from './app/descarga-bambu.mjs';
import { probarRed } from './app/red.mjs';
import { probarImpresoras } from './app/impresoras.mjs';
import { probarRecientes } from './app/recientes.mjs';
import { probarTransformar } from './app/transformar.mjs';
import { probarTorres } from './app/torres.mjs';
import { probarVisorDiferido } from './app/visor-diferido.mjs';
import { probarVistaLiviana } from './app/vista-liviana.mjs';
import { probarIdiomaArranque, probarIdiomaSelector } from './app/idioma.mjs';
import { probarOffline } from './app/offline.mjs';
import { probarAcomodoConGiros, probarPrecioTrasRecargar } from './app/piezas-extra.mjs';
import { probarBloqueos } from './app/bloqueos.mjs';
import { probarBloqueosModos } from './app/bloqueos-modos.mjs';
import { probarSoportesTipo } from './app/soportes-tipo.mjs';
import { probarSoportesEstado } from './app/soportes-estado.mjs';
import { probarVisorBloqueos } from './app/visor-bloqueos.mjs';

// Vuelve del paso 2 al 1: probarSoportesTipo termina en el paso 2 y probarCancelar también parte del 2.
const volverAlPaso1 = async ctx => {
    await ctx.page.goBack();
};

const AREAS = [
    probarModelo,
    probarFormatos,
    probarGestos,
    probarPiezas,
    probarCopias,
    probarAcomodoConGiros,
    probarBloqueos, // ADR 0004: zonas sin soporte (paso 1, cubo, 100 %); deja el paso 1
    probarBloqueosModos, // ADR 0004: modos excluyentes y pieza no activa (mismo estado de entrada y de salida)
    probarConfig,
    probarContraste, // ADR 0008, A1: mide colores en el paso 2 (y el 1 con atrás/adelante); no cambia el estado
    probarAccesibilidadPasos, // ADR 0008, A2: aria-current, foco y hojas modales (deja el paso 2, sin hojas)
    volverAlPaso1,
    probarSoportesTipo, // ADR 0004: selector de tipo (parte del paso 1 con el cubo y soportes 'no'); deja el paso 2
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
    // ADR 0007: envío por red local. Va acá porque parte del paso 2 con el cubo y la Ender 3 V3 SE (lo que deja
    // descarga-bambu), relamina para tener el paso 4 y vuelve al paso 2 sin config: cambios-gcode espera ese estado.
    probarRed,
    probarCambiosGcode,
    probarImpresoras,
    probarRecientes,
    probarTransformar,
    probarTorres,
    probarPrecioTrasRecargar,
    probarSoportesEstado, // ADR 0004: migración de preferencias y laminar con árbol y una zona (recarga la página)
    probarVisorBloqueos, // ADR 0004: toque con punto y marcas en un visor de prueba (no usa el estado de la app)
    probarVisorDiferido,
    probarVistaLiviana,
    probarIdiomaArranque, // ADR 0008, I3: contextos propios con otro navigator.languages (no toca la página del recorrido)
    probarIdiomaSelector, // ADR 0008, I3: contexto propio; destapa #idioma con evaluate
    probarOffline,
];

const ctx = await iniciarApp();
try {
    for (const area of AREAS) await area(ctx);
} finally {
    await ctx.cerrar();
}
process.exit(ctx.terminar());
