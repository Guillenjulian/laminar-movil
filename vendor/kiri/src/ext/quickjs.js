// shim: QuickJS (~2,5 MB de WASM) lo usa Kiri como sandbox para evaluar las
// macros del G-code ({temp}, {layer}, etc.). Si el VM devuelve undefined,
// Kiri cae a su propio eval() (kiri/core/print.js, constReplace). Este stub
// hace exactamente eso: un VM falso que nunca evalúa nada.
// Como las plantillas de G-code salen de nuestros propios JSON, no hace falta
// el sandbox.
const handle = () => ({ dispose() {} });
const vmFalso = new Proxy({}, {
    get(_, prop) {
        if (prop === 'evalCode') return () => ({ value: handle() });
        if (prop === 'dump') return () => undefined;
        if (prop === 'global' || prop === 'null' || prop === 'undefined' ||
            prop === 'true' || prop === 'false') return handle();
        return () => handle(); // setProp, newNumber, newObject, dispose, ...
    },
});
export async function getQuickJS() {
    return { newContext: () => vmFalso };
}
