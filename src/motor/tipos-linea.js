// Tipos de línea que Kiri marca en el G-code con "; feature ..." y el color con
// que se dibujan en la vista previa (lo usan el worker y la leyenda).
export const TIPOS = [
    { nombre: 'Perímetro', claves: ['shells'], color: [240, 138, 36] },
    { nombre: 'Relleno sólido', claves: ['solid fill'], color: [224, 79, 95] },
    { nombre: 'Relleno', claves: ['sparse infill'], color: [61, 139, 253] },
    { nombre: 'Soporte', claves: ['support'], color: [46, 196, 182] },
    { nombre: 'Falda / borde', claves: ['brim', 'skirt', 'raft'], color: [155, 89, 182] },
    { nombre: 'Otro', claves: [], color: [150, 150, 150] },
];

// Las coordenadas de la vista previa se guardan como enteros de 16 bits:
// (mm + DESPLAZAMIENTO) × ESCALA. Resolución de 0,02 mm (de sobra para dibujar)
// y la mitad de memoria que con floats. Cubre de −600 a +710 mm.
export const CUANTIZADO = { ESCALA: 50, DESPLAZAMIENTO: 600 };
