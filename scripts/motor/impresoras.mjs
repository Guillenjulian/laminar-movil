// Todas las impresoras importadas de Kiri (laminado en Chromium): cada una lamina el cubo en Rápido, centrado según el
// origen de su cama, con ventilador, sin macros sin reemplazar y a ~20 mm de alto; y la pausa de filamento en
// impresoras con otros marcadores de capa o extrusión absoluta.

import { analizar, probarPausa } from './ayudas.mjs';

// Lamina el cubo en la impresora y devuelve el texto del problema, o '' si está bien.
async function problemaDe(pagina, imp) {
    try {
        const r = await pagina.evaluate(o => window.probar(o), {
            caso: 'cubo',
            impresoraId: imp.id,
            calidad: 'rapido',
        });
        const g = analizar(r.gcode);
        const d = await pagina.evaluate(id => window.buscarImpresora(id).dispositivo, imp.id);
        // dónde tendría que estar el centro del cubo según el origen de la cama
        const cx = d.originCenter ? 0 : d.bedWidth / 2,
            cy = d.originCenter ? 0 : d.bedDepth / 2;
        const centrado = Math.abs((g.x[0] + g.x[1]) / 2 - cx) < 1 && Math.abs((g.y[0] + g.y[1]) / 2 - cy) < 1;
        const fallas = [
            !centrado && `no centrado (X ${g.x} Y ${g.y})`,
            !g.tiene('M106 S255') && 'sin ventilador',
            /\{[a-z_]+\}/.test(r.gcode) && 'macros sin reemplazar',
            Math.abs(g.zMax - 20) > 1.5 && `Z máx ${g.zMax}`,
        ].filter(Boolean);
        return fallas.length ? `${imp.nombre}: ${fallas.join(', ')}` : '';
    } catch (err) {
        return `${imp.nombre}: ERROR ${err.message.slice(0, 120)}`;
    }
}

export async function probarImpresoras({ revisar, pagina }) {
    // 5. Todas las impresoras importadas de Kiri laminan bien el cubo.
    const lista = await pagina.evaluate(() => window.impresoras);
    const problemas = [];
    for (const imp of lista.filter(i => i.estado === 'importado')) {
        const problema = await problemaDe(pagina, imp);
        if (problema) problemas.push(problema);
    }
    // Pausa en impresoras con otros marcadores de capa / extrusión absoluta.
    for (const id of ['kiri-prusa-i3-mk3s', 'kiri-creality-ender-5', 'kiri-anycubic-kobra', 'kiri-anycubic-chiron']) {
        const r = await pagina.evaluate(o => window.probar(o), { caso: 'cubo', impresoraId: id, calidad: 'rapido' });
        const p = probarPausa(r.gcode, 20);
        revisar(`pausa en ${id}`, p.ok, p.detalle);
    }
    revisar(
        `las ${lista.filter(i => i.estado === 'importado').length} impresoras importadas laminan bien`,
        problemas.length === 0,
        problemas.length ? '\n      ' + problemas.join('\n      ') : '',
    );
}
