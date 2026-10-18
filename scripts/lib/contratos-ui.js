// Contratos de src/ui/ (ADR 0001, secciones 2 y 3). exports: nombre -> aridad o "valor"; importa: rutas de src/ sin .js
/** Base común (estado, navegación y util-dom). NO la usa paso2-config: el ADR no le permite navegacion. */
const conBase = (...otros) => ['ui/estado', 'ui/navegacion', 'ui/util-dom', ...otros];
const PERFILES = 'perfiles/perfiles';
const VISOR = 'ui/visor';
const FORMATO = 'ui/formato';
const MOTOR = 'motor/motor';

/** @type {Record<string, {exports: Record<string, number|'valor'>, importa: string[]}>} */
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
        importa: [PERFILES, 'almacen', 'motor/transformar', 'motor/tipos-linea', 'ui/avanzado'],
    },
    'ui/navegacion': {
        exports: { iniciarNavegacion: 0, mostrar: 1, irA: 1, abrirHoja: 1, cerrarHojas: 0, alMostrarPaso: 1 },
        importa: ['ui/estado', 'ui/util-dom'],
    },
    'ui/paso1-modelo': {
        exports: { iniciarPaso1: 0, alCambiarImpresora: 0, elegirOtroModelo: 0, mostrarRecientes: 0 },
        importa: conBase(VISOR, 'ui/litofania', FORMATO, MOTOR, 'motor/transformar', PERFILES, 'almacen', 'config'),
    },
    'ui/impresoras': {
        exports: { iniciarImpresoras: 1, dibujarImpresoraElegida: 0 },
        importa: conBase(PERFILES, 'perfiles/generico'),
    },
    'ui/paso2-config': {
        exports: { iniciarPaso2: 0, dibujarOpciones: 0, resumenPersonal: 1 },
        importa: [
            'ui/estado',
            'ui/util-dom',
            'ui/impresoras',
            'ui/avanzado',
            'ui/materiales',
            'ui/iconos-relleno',
            PERFILES,
        ],
    },
    'ui/vista-capas': {
        exports: { iniciarVistaCapas: 0, armarVistaPrevia: 0 },
        importa: conBase(VISOR, FORMATO, MOTOR, 'motor/tipos-linea', PERFILES, 'config'),
    },
    'ui/paso3-laminar': { exports: { iniciarPaso3: 1 }, importa: conBase(MOTOR, PERFILES, 'config') },
    'ui/paso4-resultado': {
        exports: { iniciarPaso4: 1, mostrarResultado: 0 },
        importa: conBase('ui/vista-capas', 'ui/paso2-config', FORMATO, 'ui/materiales', 'motor/pausas', PERFILES),
    },
    'ui/actualizacion': { exports: { registrarServiceWorker: 0 }, importa: ['ui/util-dom'] },
};
