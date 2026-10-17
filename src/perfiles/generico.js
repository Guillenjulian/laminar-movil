// Piezas comunes para armar perfiles de impresora "a partir de pocos datos":
// lo usan el script que importa las impresoras de Kiri y el formulario
// "Mi impresora". Las fórmulas reproducen los valores de la Ender 3 V3 SE
// con boquilla de 0,4 (0,28 / 0,2 / 0,12 mm, etc.).

const redondear = (n, paso = 0.02) => Math.round(n / paso) * paso;

// Calidades Rápido / Normal / Detalle según la boquilla y la velocidad base (mm/s).
export function generarCalidades(boquilla = 0.4, velocidad = 60, perimetro = velocidad * 0.6) {
    const calidad = (nombre, descripcion, factorCapa, factorVel, extra) => {
        const capa = +redondear(boquilla * factorCapa).toFixed(2);
        return {
            nombre,
            descripcion: descripcion.replace('{capa}', capa.toLocaleString('es-AR')),
            proceso: {
                sliceHeight: capa,
                // la primera capa nunca más fina que media boquilla (mejor adhesión)
                firstSliceHeight: +Math.max(capa, redondear(boquilla * 0.5)).toFixed(2),
                sliceTopLayers: Math.ceil(0.8 / capa - 1e-9),
                sliceBottomLayers: Math.ceil(0.6 / capa - 1e-9),
                outputFeedrate: Math.round(velocidad * factorVel),
                outputFinishrate: Math.round(perimetro * factorVel),
                ...extra,
            },
        };
    };
    return {
        rapido: calidad('Rápido', 'Capas de {capa} mm. Ideal para prototipos.', 0.7, 1.2, { sliceShells: 2, sliceFillSparse: 0.15 }),
        normal: calidad('Normal', 'Capas de {capa} mm. Buen equilibrio entre tiempo y terminación.', 0.5, 1, { sliceShells: 3, sliceFillSparse: 0.2 }),
        detalle: calidad('Detalle', 'Capas de {capa} mm. Más lento, mejor terminación.', 0.3, 0.7, { sliceShells: 3, sliceFillSparse: 0.2 }),
    };
}

// G-code de inicio y fin básicos, para "Mi impresora".
export const PLANTILLAS_GCODE = {
    marlin: {
        nombre: 'Marlin',
        inicio: [
            'M140 S{bed_temp}        ; calentar cama',
            'M104 S{temp}            ; calentar boquilla',
            'M190 S{bed_temp}        ; esperar la cama',
            'M109 S{temp}            ; esperar la boquilla',
            'G28                     ; home',
            'G90                     ; coordenadas absolutas',
            'M83                     ; extrusor relativo',
            'G92 E0',
        ],
        fin: [
            'G91',
            'G1 E-2 F2700            ; retraer',
            'G1 Z10 F600             ; subir',
            'G90',
            'M106 S0                 ; apagar ventilador',
            'M104 S0                 ; apagar boquilla',
            'M140 S0                 ; apagar cama',
            'M84                     ; soltar motores',
        ],
    },
    klipper: {
        nombre: 'Klipper',
        inicio: [
            'PRINT_START BED_TEMP={bed_temp} EXTRUDER_TEMP={temp}  ; macro de tu printer.cfg',
            'G90',
            'M83',
            'G92 E0',
        ],
        fin: ['PRINT_END                ; macro de tu printer.cfg'],
    },
};

// Arma un perfil completo a partir de los datos del formulario "Mi impresora".
export function perfilPropio(datos) {
    const plantilla = PLANTILLAS_GCODE[datos.firmware] || PLANTILLAS_GCODE.marlin;
    return {
        id: datos.id,
        nombre: datos.nombre,
        marca: 'Mis impresoras',
        estado: 'propio',
        adhesion: 'falda',
        limites: { hotendMax: datos.hotendMax, camaMax: datos.camaMax },
        firmware: datos.firmware,
        dispositivo: {
            deviceName: datos.nombre,
            bedWidth: datos.ancho,
            bedDepth: datos.profundidad,
            maxHeight: datos.alto,
            originCenter: !!datos.origenCentro,
            fwRetract: false,
            gcodeFExt: 'gcode',
            extruders: [{ extNozzle: datos.boquilla, extFilament: datos.filamento, extOffsetX: 0, extOffsetY: 0 }],
            gcodePre: datos.inicio ?? plantilla.inicio,
            gcodePost: datos.fin ?? plantilla.fin,
            gcodeFan: ['M106 S{fan_speed}'],
            gcodeTrack: ['M73 P{progress}'],
            gcodeLayer: [';LAYER:{layer}'],
        },
        proceso: {
            outputRetractDist: datos.retraccion,
            outputRetractSpeed: 40,
            outputSeekrate: Math.max(80, Math.round(datos.velocidad * 1.5)),
            firstLayerRate: 25,
            firstLayerFillRate: 25,
            zHopDistance: 0,
            sliceFillType: 'hex',
            sliceSupportType: 'disabled',
        },
        calidades: generarCalidades(datos.boquilla, datos.velocidad),
    };
}
