// shim: manifold (booleanas de malla, ~1 MB de WASM) sólo se usa en CAM y
// en el editor de mallas, no en FDM. Devolvemos una promesa que nunca
// resuelve para que geo/csg.js no descargue el WASM.
export default function manifold() { return new Promise(() => {}); }
