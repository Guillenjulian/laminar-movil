// Junta src/textos/es/*.json en un solo objeto (un chunk por idioma). No se edita: agregar un área = agregar su .json.
const partes = import.meta.glob('./es/*.json', { eager: true, import: 'default' });
/** @type {import('./traducir.js').Diccionario} */
export default Object.assign({}, ...Object.values(partes));
