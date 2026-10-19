// Cola de tareas síncronas que se corren de a una y ceden el hilo cada tanto, así el worker puede
// mandar los avisos de progreso a la interfaz mientras calcula (si no, llegan todos juntos al final).

const cederHilo = () => new Promise(resolver => setTimeout(resolver, 0));

/**
 * @param {number} cadaMs cada cuánto (como mucho) se cede el hilo; la primera tarea siempre cede
 * @param {()=>number} [ahora] reloj en ms (se inyecta en las pruebas)
 * @returns {<T>(tarea:()=>T)=>Promise<T>} encola una tarea y devuelve su resultado
 */
export function crearColaCediendo(cadaMs, ahora = () => performance.now()) {
    let cola = Promise.resolve();
    let ultimaCesion = -Infinity;
    return tarea => {
        const hecha = cola.then(async () => {
            if (ahora() - ultimaCesion >= cadaMs) {
                await cederHilo();
                ultimaCesion = ahora();
            }
            return tarea();
        });
        cola = hecha.catch(() => {}); // un error de una tarea no frena a las que siguen
        return hecha;
    };
}
