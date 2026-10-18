// Poda de los troncos colgados del soporte árbol (ADR 0004, vuelta 2 de T1): funciones puras, sin imports.
//
// Un tronco que baja puede quedarse sin camino por un bloqueo o por el borde de la cama. Si lo dejáramos, el tramo
// de arriba quedaría flotando en el aire (se imprime mal). Decisión del CTO: sin soporte ahí es mejor que un soporte
// en el aire, así que una pasada final poda todo tramo cuyo extremo inferior no termina en la cama, en la pieza o
// fusionado con otro tronco que sí llega.
//
// Cada nodo del planificador lleva estos campos, que `planificarArbol` completa al bajar de capa:
//   hijo     el nodo de la capa de abajo en el que se convirtió al bajar (puede haberse fusionado después)
//   destino  el nodo con el que se fusionó, si se fusionó
//   fin      'pieza' si no pudo bajar porque quedaba apoyado en la pieza, 'colgado' si no pudo por otra causa

/**
 * Sigue las fusiones hasta el nodo que de verdad quedó en la capa.
 * @param {{destino?: object}} nodo
 * @returns {object}
 */
function destinoFinal(nodo) {
    let n = nodo;
    while (n.destino) n = n.destino;
    return n;
}

/**
 * Marca `viable` en cada nodo, de abajo hacia arriba: es viable el de la primera capa (apoya en la cama), el que
 * terminó apoyado en la pieza y el que bajó a un nodo viable. El colgado no lo es, ni nada que dependa de él.
 * @param {object[][]} registro  `registro[i]` = nodos de la capa i (índice 0 = primera capa)
 * @returns {void}
 */
export function marcarViables(registro) {
    registro.forEach((nodos, i) => {
        for (const n of nodos) {
            if (i === 0 || n.fin === 'pieza') n.viable = true;
            else n.viable = n.fin !== 'colgado' && destinoFinal(n.hijo).viable === true;
        }
    });
}
