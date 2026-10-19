// Contratos de src/ui/ (ADR 0001, secciones 2 y 3). exports: nombre -> aridad o "valor"; importa: rutas de src/ sin .js
/** Base común (estado, navegación y util-dom). NO la usa paso2-config: el ADR no le permite navegacion. */
const conBase = (...otros) => ['ui/estado', 'ui/navegacion', 'ui/util-dom', ...otros];
const PERFILES = 'perfiles/perfiles';
const VISOR = 'ui/visor-carga';
const FORMATO = 'ui/formato';
const MOTOR = 'motor/motor';

/** @type {Record<string, {exports: Record<string, number|'valor'>, importa: string[]}>} */
export const CONTRATOS = {
    'ui/util-dom': { exports: { $: 1, escapar: 1 }, importa: [] },
    'ui/estado': {
        exports: {
            estado: 'valor',
            matrizModelo: 0,
            crearPieza: 1,
            piezaActiva: 0,
            matrizPieza: 1,
            copiasTotales: 0,
            piezasParaMotor: 0,
            valoresActuales: 0,
            guardarPreferencias: 0,
            guardarPropias: 0,
            cargarPreferencias: 0,
        },
        importa: [PERFILES, 'perfiles/soportes', 'almacen', 'motor/transformar', 'motor/tipos-linea', 'ui/avanzado'],
    },
    'ui/navegacion': {
        exports: {
            iniciarNavegacion: 0,
            mostrar: 1,
            irA: 1,
            abrirHoja: 1,
            cerrarHojas: 0,
            alMostrarPaso: 1,
            irAPaso1: 0,
            devolverFocoAlCerrar: 4,
        },
        importa: ['ui/estado', 'ui/util-dom'],
    },
    'ui/paso1-modelo': {
        exports: { iniciarPaso1: 0, alCambiarImpresora: 0, elegirOtroModelo: 0, mostrarRecientes: 0 },
        importa: conBase(
            VISOR,
            'ui/litofania',
            'ui/torres',
            MOTOR,
            PERFILES,
            'almacen',
            'ui/recientes',
            'ui/ajuste-modelo',
            'ui/piezas-ui',
            'ui/bloqueos-ui',
        ),
    },
    'ui/acomodo': {
        exports: { acomodarPiezas: 1 },
        importa: ['config', 'motor/piezas', 'motor/transformar', PERFILES, 'ui/estado'],
    },
    'ui/ajuste-modelo': {
        exports: { crearAjuste: 1 },
        importa: ['ui/estado', 'ui/util-dom', FORMATO, 'motor/transformar', PERFILES, 'config'],
    },
    'ui/piezas-ui': {
        exports: { crearPiezas: 1 },
        importa: ['ui/estado', 'ui/util-dom', 'config', 'motor/piezas', 'ui/acomodo', 'ui/copias-ui'],
    },
    'ui/copias-ui': {
        exports: { crearCopias: 1 },
        importa: ['ui/estado', 'ui/util-dom', 'config', 'motor/piezas'],
    },
    'ui/torres': {
        exports: { prepararTorre: 1 },
        importa: ['perfiles/torres', PERFILES, MOTOR, 'ui/navegacion', 'ui/util-dom', FORMATO],
    },
    'ui/recientes': {
        exports: { iniciarRecientes: 1, mostrarRecientes: 0, programarGuardado: 0, guardarPendiente: 0 },
        importa: ['almacen', 'ui/estado', 'ui/navegacion', 'ui/util-dom', FORMATO],
    },
    'ui/impresoras': {
        exports: { iniciarImpresoras: 1, dibujarImpresoraElegida: 0 },
        importa: conBase(PERFILES, 'ui/formulario-impresora'),
    },
    'ui/formulario-impresora': {
        exports: { iniciarFormularioImpresora: 1 },
        importa: conBase(PERFILES, 'perfiles/generico'),
    },
    'ui/paso2-config': {
        exports: { iniciarPaso2: 0, dibujarOpciones: 0, resumenPersonal: 1 },
        importa: [
            'ui/estado',
            'ui/acomodo',
            'ui/util-dom',
            'ui/impresoras',
            'ui/avanzado',
            'ui/cambios',
            'ui/materiales',
            'ui/iconos-relleno',
            'ui/soportes-tipo-ui',
            PERFILES,
            'perfiles/torres',
        ],
    },
    'ui/cambios': {
        exports: { crearCambios: 1, resumenCambios: 1 },
        importa: ['perfiles/cambios', 'ui/util-dom'],
    },
    'ui/vista-capas': {
        exports: { iniciarVistaCapas: 1, armarVistaPrevia: 0 },
        importa: conBase(
            VISOR,
            FORMATO,
            MOTOR,
            'motor/tipos-linea',
            PERFILES,
            'config',
            'ui/pausas-ui',
            'ui/aviso-vista',
        ),
    },
    'ui/aviso-vista': { exports: { textoAvisoVista: 2 }, importa: [] },
    'ui/pausas-ui': {
        exports: { conectarPausas: 1, dibujarPausas: 0 },
        importa: ['ui/estado', 'ui/util-dom', FORMATO, 'motor/tipos-linea', PERFILES],
    },
    'ui/paso3-laminar': {
        exports: { iniciarPaso3: 1 },
        importa: conBase(MOTOR, PERFILES, 'perfiles/cambios', 'perfiles/torres', 'config', 'ui/acomodo'),
    },
    'ui/paso4-resultado': {
        exports: { iniciarPaso4: 1, mostrarResultado: 0 },
        importa: conBase(
            'ui/vista-capas',
            'ui/paso2-config',
            FORMATO,
            'ui/materiales',
            'ui/entrega',
            'ui/entrega-ui',
            'ui/soportes-tipo-ui',
            PERFILES,
            'perfiles/cambios',
            'perfiles/soportes',
        ),
    },
    'ui/entrega': {
        exports: { nombreEntrega: 2, mimeEntrega: 1, armarEntrega: 5 },
        importa: ['motor/pausas', 'motor/bambu-3mf'],
    },
    'ui/entrega-ui': {
        exports: {
            entregaDe: 0,
            archivoEntrega: 0,
            precargar: 0,
            programarPrecarga: 0,
            soltarEntrega: 0,
            esperarArchivo: 1,
            puedeCompartir: 1,
            paraCompartir: 1,
        },
        importa: ['ui/estado', 'ui/util-dom', 'ui/materiales', 'ui/entrega', PERFILES],
    },
    'ui/visor-cara': { exports: { crearSelectorCara: 1 }, importa: [] },
    'ui/visor-recorridos': { exports: { crearRecorridos: 1 }, importa: ['motor/tipos-linea'] },
    'ui/visor-cama': { exports: { reemplazarCama: 3 }, importa: [] },
    'ui/visor-bloqueos': { exports: { crearMarcasBloqueo: 1 }, importa: [] },
    'ui/visor': {
        exports: { crearVisor: 1 },
        importa: ['ui/visor-cara', 'ui/visor-recorridos', 'ui/visor-cama', 'ui/visor-bloqueos'],
    },
    // Zonas sin soporte (paso 1) y tipo de soporte (paso 2), ADR 0004. El visor entra a bloqueos-ui por `ctx`.
    'ui/bloqueos-ui': {
        exports: { NOTA_VOLADIZO: 'valor', AVISO_VACIADAS: 'valor', firmaPieza: 1, chipZona: 4, crearBloqueosUI: 1 },
        importa: ['motor/bloqueos', 'ui/estado', 'ui/util-dom'],
    },
    'ui/soportes-tipo-ui': {
        exports: { OPCIONES_SOPORTE: 'valor', textoZonasSinSoporte: 1, zonasVigentes: 0, crearTipoSoportes: 1 },
        importa: ['perfiles/soportes', 'ui/estado', 'ui/util-dom'],
    },
    // Único que importa ui/visor, con import() dinámico (three.js sale del chunk principal, ADR 0006).
    'ui/visor-carga': { exports: { crearVisor: 2, precargarVisor: 0, armarVisorCarga: 1 }, importa: ['ui/visor'] },
    // Idioma (ADR 0008, B.6/B.7). `ui/idioma` es hoja; es.js y en.js se importan con import() dinámico.
    'textos/traducir': {
        exports: {
            IDIOMAS: 'valor',
            IDIOMA_BASE: 'valor',
            LOCALES: 'valor',
            interpolar: 2,
            elegirForma: 3,
            traducir: 5,
            elegirIdioma: 2,
            variablesDe: 1,
        },
        importa: [],
    },
    'textos/es': { exports: { default: 'valor' }, importa: [] },
    'textos/en': { exports: { default: 'valor' }, importa: [] },
    'ui/idioma': {
        exports: {
            t: 2,
            marcar: 1,
            existe: 1,
            idiomaActual: 0,
            localeActual: 0,
            iniciarIdioma: 1,
            cambiarIdioma: 1,
            alCambiarIdioma: 1,
            ponerDiccionarios: 3,
        },
        importa: ['almacen', 'textos/traducir', 'textos/es', 'textos/en'],
    },
    'ui/actualizacion': { exports: { registrarServiceWorker: 0 }, importa: ['ui/util-dom'] },
};
