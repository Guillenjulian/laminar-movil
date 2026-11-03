// Medidas y alturas de la placa QR (ver placa-qr.js). Módulo aparte y sin dependencias para que la UI
// las use sin cargar el generador de QR.

export const PLACA = { ancho: 100, alto: 150, base: 1.6, relieve: 2.2, destacado: 2.6 };
/** Alturas (mm) donde hay que cambiar el filamento y el color de cada tramo, de abajo hacia arriba. */
export const PAUSAS_PLACA = [PLACA.base, PLACA.relieve];
export const COLORES_PLACA = ['#ffffff', '#1a1a1a', '#7a1228'];
