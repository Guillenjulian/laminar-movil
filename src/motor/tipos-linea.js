// Tipos de línea que Kiri marca en el G-code con "; feature ..." y el color con
// que se dibujan en la vista previa (lo usan el worker y la leyenda).
// `brillo`: al pintar "por filamento", cada tipo usa el color del filamento un poco
// más claro u oscuro, para que se sigan distinguiendo paredes y relleno.
export const TIPOS = [
    { nombre: 'Perímetro', claves: ['shells'], color: [240, 138, 36], brillo: 1 },
    { nombre: 'Relleno sólido', claves: ['solid fill'], color: [224, 79, 95], brillo: 0.85 },
    { nombre: 'Relleno', claves: ['sparse infill'], color: [61, 139, 253], brillo: 0.7 },
    { nombre: 'Soporte', claves: ['support'], color: [46, 196, 182], brillo: 0.55 },
    { nombre: 'Falda / borde', claves: ['brim', 'skirt', 'raft'], color: [155, 89, 182], brillo: 0.8 },
    { nombre: 'Otro', claves: [], color: [150, 150, 150], brillo: 0.6 },
];

// Colores sugeridos para cada filamento (el usuario los puede cambiar).
export const COLORES_FILAMENTO = ['#f08a24', '#3d8bfd', '#e04f5f', '#2ec4b6', '#f2c94c', '#9b59b6', '#3a3a3a', '#f4f4f4'];

// Las coordenadas de la vista previa se guardan como enteros de 16 bits:
// (mm + DESPLAZAMIENTO) × ESCALA. Resolución de 0,02 mm (de sobra para dibujar)
// y la mitad de memoria que con floats. Cubre de −600 a +710 mm.
export const CUANTIZADO = { ESCALA: 50, DESPLAZAMIENTO: 600 };
