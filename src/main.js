// Punto de entrada: sólo cablea los módulos de src/ui/ y arranca la app (ver docs/decisiones/0001-dividir-main.md).
//
// Flujo de arranque, en este orden:
// 1. Listeners: cada iniciarX() engancha sus controles. Van ANTES del await para que los botones
//    respondan aunque la lectura de preferencias tarde.
// 2. Preferencias y precios: un solo await. Todo lo que depende de ellos (incluido el costo) se dibuja después.
// 3. Primer dibujo: opciones, pantalla 1 y modelos recientes.
// 4. Tareas de fondo: pedir almacenamiento persistente, registrar el service worker (sólo en el build) y
//    precargar el chunk del visor 3D (three.js) cuando el navegador está libre (ADR 0006).

import * as almacen from './almacen.js';
import * as materialesUI from './ui/materiales.js';
import { cargarPreferencias } from './ui/estado.js';
import { iniciarIdioma } from './ui/idioma.js';
import { iniciarIdiomaDom } from './ui/idioma-dom.js';
import { iniciarNavegacion, mostrar, alMostrarPaso, irAPaso1 } from './ui/navegacion.js';
import { iniciarImpresoras } from './ui/impresoras.js';
import { iniciarPaso2, dibujarOpciones } from './ui/paso2-config.js';
import { iniciarPaso1, alCambiarImpresora, elegirOtroModelo, mostrarRecientes } from './ui/paso1-modelo.js';
import { iniciarPaso3 } from './ui/paso3-laminar.js';
import { iniciarPaso4, mostrarResultado } from './ui/paso4-resultado.js';
import { iniciarVistaCapas } from './ui/vista-capas.js';
import { programarPrecarga } from './ui/entrega-ui.js';
import { iniciarRedHoja, abrirRedHoja } from './ui/red-hoja.js';
import { iniciarEnvio, actualizarEnvio } from './ui/envio-ui.js';
import { normalizarDireccion } from './red/direccion.js';
import { crearRepositorioRed } from './red/config-red.js';
import { registrarServiceWorker } from './ui/actualizacion.js';
import { precargarVisor } from './ui/visor-carga.js';

// 1. Listeners.
iniciarNavegacion();
iniciarPaso1();
const preciosListos = materialesUI.iniciarMateriales();
iniciarImpresoras({
    alElegir: () => {
        dibujarOpciones();
        alCambiarImpresora();
    },
});
iniciarPaso2({ irAPaso1 });
// Al entrar al paso 2 se redibuja: el modelo nuevo (y su torre, si es una) cambia lo que muestra.
alMostrarPaso(paso => paso === 2 && dibujarOpciones());
iniciarPaso3({ alTerminar: mostrarResultado });
iniciarPaso4({ alOtroModelo: elegirOtroModelo });
iniciarVistaCapas({ alCambiarPausas: programarPrecarga });
// Envío por red local (ADR 0007): cliente y transporte se bajan recién al probar o enviar (import() memoizado;
// si falla se reintenta la próxima vez). Los envoltorios nunca lanzan.
let redLista = null;
const cargarRed = () =>
    (redLista ??= Promise.all([import('./red/cliente.js'), import('./red/transporte.js')]).then(([c, t]) => {
        const usarFetch = (...a) => fetch(...a);
        const deps = { transporte: t.crearTransporte({ fetch: usarFetch }), sonda: u => t.sondaSinCors(u, usarFetch) };
        return { ...c, deps: { ...deps, origenApp: location.origin } };
    })).catch(e => {
        redLista = null;
        throw e;
    });
const falloCarga = {
    ok: false,
    error: { codigo: 'carga', mensaje: 'No se pudo cargar el envío.', pista: 'Recargá la app y probá de nuevo.' },
};
const conRed = async uso => cargarRed().then(uso, () => falloCarga);
const repositorio = crearRepositorioRed(almacen);
iniciarRedHoja({
    repositorio,
    probarConexion: config => conRed(r => r.probarConexion(config, r.deps)),
    normalizarDireccion,
    alGuardar: actualizarEnvio,
});
iniciarEnvio({
    repositorio,
    enviarGcode: (config, archivo, nombre, opciones) =>
        conRed(r => r.enviarGcode(config, archivo, nombre, r.deps, opciones)),
    abrirConfiguracion: abrirRedHoja,
});

// 2. Preferencias e idioma (en español el HTML ya está traducido: no se recorre el DOM).
await Promise.all([cargarPreferencias(), preciosListos, iniciarIdioma()]);
iniciarIdiomaDom();

// 3. Primer dibujo.
dibujarOpciones();
mostrar(1);
mostrarRecientes();

// 4. Tareas de fondo.
almacen.pedirAlmacenamientoPersistente();
registrarServiceWorker();
if (window.requestIdleCallback) requestIdleCallback(precargarVisor, { timeout: 3000 });
else setTimeout(precargarVisor, 1);
