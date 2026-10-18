// Contratos de src/ui/ (ADR 0001, secciones 2 y 3). exports: nombre -> aridad o "valor"; importa: rutas de src/ sin .js
const dom = (...otros) => ['ui/estado', 'ui/navegacion', 'ui/util-dom', ...otros];
const P = 'perfiles/perfiles';
const V = 'ui/visor';
const F = 'ui/formato';
const M = 'motor/motor';

export const CONTRATOS = {
    'ui/util-dom': { exports: { $: 1, escapar: 1 }, importa: [] },
    'ui/estado': {
        exports: {
            estado: 'valor',
            matrizModelo: 0,
            valoresActuales: 0,
            guardarPreferencias: 0,
            guardarPropias: 0,
            cargarPreferencias: 0,
        },
        importa: [P, 'almacen', 'motor/transformar', 'motor/tipos-linea', 'ui/avanzado'],
    },
    'ui/navegacion': {
        exports: { iniciarNavegacion: 0, mostrar: 1, irA: 1, abrirHoja: 1, cerrarHojas: 0, alMostrarPaso: 1 },
        importa: ['ui/estado', 'ui/util-dom'],
    },
    'ui/paso1-modelo': {
        exports: { iniciarPaso1: 0, alCambiarImpresora: 0, elegirOtroModelo: 0, mostrarRecientes: 0 },
        importa: dom(V, 'ui/litofania', F, M, 'motor/transformar', P, 'almacen', 'config'),
    },
    'ui/impresoras': {
        exports: { iniciarImpresoras: 1, dibujarImpresoraElegida: 0 },
        importa: dom(P, 'perfiles/generico'),
    },
    'ui/paso2-config': {
        exports: { iniciarPaso2: 0, dibujarOpciones: 0, resumenPersonal: 1 },
        importa: dom('ui/impresoras', 'ui/avanzado', 'ui/materiales', 'ui/iconos-relleno', P),
    },
    'ui/vista-capas': {
        exports: { iniciarVistaCapas: 0, armarVistaPrevia: 0 },
        importa: dom(V, F, M, 'motor/tipos-linea', P, 'config'),
    },
    'ui/paso3-laminar': { exports: { iniciarPaso3: 1 }, importa: dom(M, P, 'config') },
    'ui/paso4-resultado': {
        exports: { iniciarPaso4: 1, mostrarResultado: 0 },
        importa: dom('ui/vista-capas', 'ui/paso2-config', F, 'ui/materiales', 'motor/pausas', P),
    },
    'ui/actualizacion': { exports: { registrarServiceWorker: 0 }, importa: ['ui/util-dom'] },
};
