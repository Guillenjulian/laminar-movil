// Sección "Avanzado" del paso 2: modo jarrón, altura de capa variable, costura,
// retracción, z-hop, coasting, wipe, compensación de medidas, velocidad,
// temperaturas y ventilador.
//
// Igual que "Personalizar": en `estado.avanzado` se guarda SÓLO lo que el
// usuario cambió (ej. { jarron: true, tempBoquilla: 215 }); el resto sale de la
// impresora, la calidad y el material elegidos (ver valoresDeAvanzado en
// perfiles.js). estado.js lo guarda con las preferencias (IndexedDB) y paso3-laminar.js lo pasa
// a armarConfiguracion como `personal.avanzado`, que lo traduce a claves de Kiri.

import { buscarImpresora, valoresDeAvanzado, COSTURAS } from '../perfiles/perfiles.js';

const $ = id => document.getElementById(id);

// Contadores ±: paso, mínimo, máximo y cómo se muestran.
const mm = v => `${v.toLocaleString('es-AR', { maximumFractionDigits: 2 })} mm`;
const conSigno = v => (v > 0 ? '+' : v < 0 ? '−' : '') + mm(Math.abs(v));
const CONTADORES = {
    retraccion: { paso: 0.1, min: 0, max: 10, ver: mm },
    zHop: { paso: 0.1, min: 0, max: 2, ver: mm },
    coasting: { paso: 0.1, min: 0, max: 2, ver: mm },
    wipe: { paso: 0.5, min: 0, max: 5, ver: mm },
    compAgujeros: { paso: 0.05, min: -0.5, max: 0.5, ver: conSigno },
    compExterior: { paso: 0.05, min: -0.5, max: 0.5, ver: conSigno },
    tempBoquilla: { paso: 5, min: 150, max: 300, ver: v => `${v} °C` },
    tempCama: { paso: 5, min: 0, max: 120, ver: v => `${v} °C` },
};
const DESLIZADORES = { velocidad: [50, 150], ventilador: [0, 100] };

// Redondeo para que 0,1 + 0,2 no dé 0,30000000000000004.
const redondear = v => Math.round(v * 1000) / 1000;

// Lo guardado puede venir de una versión vieja o estar roto: nos quedamos sólo
// con lo que tiene sentido.
export function validarAvanzado(guardado) {
    const av = {};
    if (!guardado || typeof guardado !== 'object') return av;
    for (const clave of ['jarron', 'alturaVariable']) {
        if (typeof guardado[clave] === 'boolean') av[clave] = guardado[clave];
    }
    if (COSTURAS[guardado.costura]) av.costura = guardado.costura;
    for (const [clave, c] of Object.entries(CONTADORES)) {
        const v = guardado[clave];
        if (typeof v === 'number' && v >= c.min && v <= c.max) av[clave] = v;
    }
    for (const [clave, [min, max]] of Object.entries(DESLIZADORES)) {
        const v = guardado[clave];
        if (typeof v === 'number' && v >= min && v <= max) av[clave] = v;
    }
    return av;
}

// Resumen para el <summary> (ej. "jarrón · 215 °C · velocidad 80 %").
export function resumenAvanzado(av) {
    const partes = [];
    if (av.jarron) partes.push('jarrón');
    if (av.alturaVariable && !av.jarron) partes.push('altura variable');
    if (av.costura && !av.jarron) partes.push(`costura ${COSTURAS[av.costura].nombre.toLowerCase()}`);
    if (av.retraccion !== undefined) partes.push(`retracción ${mm(av.retraccion)}`);
    if (av.zHop !== undefined) partes.push(`z-hop ${mm(av.zHop)}`);
    if (av.coasting !== undefined) partes.push(`coasting ${mm(av.coasting)}`);
    if (av.wipe !== undefined) partes.push(`wipe ${mm(av.wipe)}`);
    if (av.compAgujeros !== undefined) partes.push(`agujeros ${conSigno(av.compAgujeros)}`);
    if (av.compExterior !== undefined) partes.push(`contorno ${conSigno(av.compExterior)}`);
    if (av.velocidad !== undefined) partes.push(`velocidad ${av.velocidad} %`);
    if (av.tempBoquilla !== undefined) partes.push(`${av.tempBoquilla} °C`);
    if (av.tempCama !== undefined) partes.push(`cama ${av.tempCama} °C`);
    if (av.ventilador !== undefined) partes.push(`ventilador ${av.ventilador} %`);
    return partes.join(' · ');
}

// Arma la sección. `estado` es el de src/ui/estado.js (usa impresoraId, calidad,
// material y avanzado); `alCambiar` se llama después de cada cambio (para
// guardar las preferencias).
export function crearAvanzado({ estado, alCambiar = () => {} }) {
    const seccion = $('avanzado');

    const base = () => valoresDeAvanzado(estado.impresoraId, estado.calidad, estado.material);
    const actuales = () => ({ ...base(), ...estado.avanzado });

    // Límites de temperatura según la impresora (si no los tiene, los de la tabla).
    function limites(clave) {
        const c = CONTADORES[clave];
        const lim = buscarImpresora(estado.impresoraId).limites || {};
        if (clave === 'tempBoquilla' && lim.hotendMax) return { ...c, max: lim.hotendMax };
        if (clave === 'tempCama' && lim.camaMax) return { ...c, max: lim.camaMax };
        return c;
    }

    // Guarda un cambio. Si coincide con el valor de fábrica, se borra (así, si
    // después cambia la impresora o el material, ese valor los sigue).
    function cambiar(clave, valor) {
        if (base()[clave] === valor) delete estado.avanzado[clave];
        else estado.avanzado[clave] = valor;
        dibujar();
        alCambiar();
    }

    function dibujar() {
        const v = actuales();
        $('avJarron').checked = v.jarron;
        $('avisoJarron').hidden = !v.jarron;
        // En modo jarrón no hay relleno: lo mostramos deshabilitado en "Personalizar".
        $('personalizar').classList.toggle('sin-relleno', v.jarron);
        $('avAlturaVariable').checked = v.alturaVariable && !v.jarron;
        $('avAlturaVariable').disabled = v.jarron;
        $('detalleAlturaVariable').textContent = v.jarron
            ? 'No se puede con el modo jarrón (la espiral necesita capas parejas).'
            : 'Capas más finas donde hay curvas; la de la calidad es la más gruesa.';

        $('avCosturas').innerHTML = Object.entries(COSTURAS)
            .map(
                ([id, c]) =>
                    `<label class="opcion">
                <input type="radio" name="costura" value="${id}" ${id === v.costura ? 'checked' : ''} ${v.jarron ? 'disabled' : ''}>
                <span><b>${c.nombre}</b><br><small>${c.descripcion}</small></span>
            </label>`,
            )
            .join('');
        seccion.querySelector('#avCosturas').classList.toggle('deshabilitado', v.jarron);

        seccion.querySelectorAll('.contador[data-av]').forEach(c => {
            const clave = c.dataset.av;
            c.querySelector('output').textContent = limites(clave).ver(v[clave]);
            c.classList.toggle('cambiado', estado.avanzado[clave] !== undefined);
        });
        $('avVelocidad').value = v.velocidad;
        $('avVelocidadValor').textContent = `${v.velocidad} %`;
        $('avVentilador').value = v.ventilador;
        $('avVentiladorValor').textContent = `${v.ventilador} %`;

        const resumen = resumenAvanzado(estado.avanzado);
        seccion.querySelector('summary').textContent = resumen
            ? `Avanzado: ${resumen}`
            : 'Avanzado: jarrón, costura, retracción, temperaturas…';
        $('avRestablecer').hidden = !Object.keys(estado.avanzado).length;
    }

    // --- Eventos ---
    $('avJarron').addEventListener('change', e => cambiar('jarron', e.target.checked));
    $('avAlturaVariable').addEventListener('change', e => cambiar('alturaVariable', e.target.checked));
    $('avCosturas').addEventListener('change', e => {
        if (e.target.name === 'costura') cambiar('costura', e.target.value);
    });
    seccion.querySelectorAll('.contador[data-av]').forEach(c =>
        c.addEventListener('click', e => {
            const b = e.target.closest('button');
            if (!b) return;
            const clave = c.dataset.av,
                l = limites(clave);
            const nuevo = redondear(actuales()[clave] + l.paso * Number(b.dataset.pasoAv));
            cambiar(clave, Math.min(l.max, Math.max(l.min, nuevo)));
        }),
    );
    for (const clave of Object.keys(DESLIZADORES)) {
        const id = clave === 'velocidad' ? 'avVelocidad' : 'avVentilador';
        // Mientras se arrastra sólo se actualiza el número; al soltar se guarda.
        $(id).addEventListener('input', e => {
            $(id + 'Valor').textContent = `${e.target.value} %`;
        });
        $(id).addEventListener('change', e => cambiar(clave, Number(e.target.value)));
    }
    $('avRestablecer').onclick = () => {
        estado.avanzado = {};
        dibujar();
        alCambiar();
    };
    // Si cambia la calidad o el material, cambian los valores de fábrica.
    // (Escuchamos en document: corre después del manejador de src/ui/paso2-config.js.)
    document.addEventListener('change', e => {
        if (e.target.name === 'calidad' || e.target.name === 'material') dibujar();
    });

    return { dibujar };
}
