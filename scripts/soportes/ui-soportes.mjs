// Pruebas de la lógica de src/ui/bloqueos-ui.js y src/ui/soportes-tipo-ui.js (Node, con el DOM falso de dom-falso.mjs).
// Las corre scripts/probar-soportes.mjs.

import { MAX_BLOQUEOS, validarBloqueos } from '../../src/motor/bloqueos.js';
import { cargar, clic, crearDom, crearVisor } from './dom-falso.mjs';

function agregar(t) {
    const { revisar, estado, $, J, pieza, visor } = t;
    const { firmaPieza } = t.m;
    console.log('\n▶ bloqueos-ui: agregar');
    revisar('sin modo "marcar" no hay oyente de toque en el visor', visor.fn === null);
    revisar('el panel se ve con un modelo', $('bloqueosPanel').hidden === false);
    $('bloqueoMarcar').onclick();
    revisar('el modo "marcar" queda con aria-pressed=true', $('bloqueoMarcar').getAttribute('aria-pressed') === 'true');
    revisar('con el modo activo el visor tiene el oyente de toque', typeof visor.fn === 'function');
    $('bloqueoRadioMas').onclick();
    $('bloqueoRadioMas').onclick(); // 10 mm
    revisar('el stepper muestra 10', $('bloqueoRadioNum').textContent === '10');
    estado.resultado = { gcode: 'x' };
    visor.fn({ id: pieza.id, punto: { x: 4.2, y: -1.5, z: 12 } });
    const z = pieza.bloqueos?.[0];
    revisar('un toque agrega una zona', pieza.bloqueos?.length === 1);
    revisar('la zona es un Bloqueo válido (validarBloqueos la deja igual)', J(validarBloqueos([z])) === J([z]));
    revisar('en el punto recibido', J(z?.centro) === J({ x: 4.2, y: -1.5, z: 12 }));
    revisar('con el radio elegido (10 mm)', z?.radio === 10);
    revisar('con el id que dio nuevoId', z?.id === 1);
    revisar('guarda la firma [rotacion, escala]', pieza.firmaBloqueos === firmaPieza(pieza));
    revisar('invalida el resultado y avisa alCambiar', estado.resultado === null && t.cambios === 1);
    revisar(
        'las marcas del visor reciben la zona y las posiciones de las copias',
        visor.marcas.at(-1)?.zonas[0].radio === 10 && visor.marcas.at(-1)?.pos.length === 2,
    );
    revisar(
        'la lista dibuja la chip con su aria-label',
        $('bloqueoLista').innerHTML.includes('aria-label="Quitar zona 1, cubo.stl"'),
    );
    revisar(
        'un toque en otra pieza no agrega',
        (visor.fn({ id: 999, punto: { x: 0, y: 0, z: 0 } }), pieza.bloqueos.length === 1),
    );
}

function radio(t) {
    const { revisar, $, pieza } = t;
    console.log('\n▶ bloqueos-ui: radio de una zona');
    $('bloqueoRadioMas').onclick();
    revisar('sin zona elegida el stepper no toca las zonas existentes', pieza.bloqueos[0].radio === 10);
    $('bloqueoLista').onclick(clic('data-zona', 1));
    revisar('elegir la chip la marca con aria-pressed', $('bloqueoLista').innerHTML.includes('aria-pressed="true"'));
    revisar('y el stepper muestra el radio de la zona', $('bloqueoRadioNum').textContent === '10');
    $('bloqueoRadioMas').onclick();
    revisar('con la zona elegida el stepper le cambia el radio', pieza.bloqueos[0].radio === 11);
    revisar('la chip muestra 11 mm', $('bloqueoLista').innerHTML.includes('11&nbsp;mm'));
    for (let i = 0; i < 60; i++) $('bloqueoRadioMas').onclick();
    revisar(
        'el radio tope es 40 mm y "+" se deshabilita',
        pieza.bloqueos[0].radio === 40 && $('bloqueoRadioMas').disabled,
    );
    for (let i = 0; i < 60; i++) $('bloqueoRadioMenos').onclick();
    revisar(
        'el radio mínimo es 2 mm y "−" se deshabilita',
        pieza.bloqueos[0].radio === 2 && $('bloqueoRadioMenos').disabled,
    );
}

function quitar(t) {
    const { revisar, dom, $, pieza, visor } = t;
    console.log('\n▶ bloqueos-ui: quitar');
    $('bloqueoLista').onclick(clic('data-quitar', 1));
    revisar('quitar saca la zona', pieza.bloqueos.length === 0 && $('bloqueoLista').innerHTML === '');
    revisar('sin zonas el foco vuelve al botón de marcar', dom.enfocado === 'bloqueoMarcar');
    revisar('las marcas se sacan del visor', visor.quitadas > 0);
    for (const x of [1, 2, 3]) visor.fn({ id: pieza.id, punto: { x, y: 0, z: 1 } });
    const [a, b, c] = pieza.bloqueos.map(z => z.id);
    $('bloqueoLista').onclick(clic('data-quitar', a));
    revisar(
        'quitar la primera de 3 deja el foco en el quitar de la que ahora es la primera',
        dom.enfocado === `data-quitar:${b}`,
    );
    $('bloqueoLista').onclick(clic('data-zona', c));
    revisar('elegir una chip la deja con aria-pressed', $('bloqueoLista').innerHTML.includes('aria-pressed="true"'));
    $('bloqueoLista').onclick(clic('data-zona', c));
    revisar('elegirla de nuevo la suelta', !$('bloqueoLista').innerHTML.includes('aria-pressed="true"'));
    $('bloqueoLista').onclick(clic('data-zona', c));
    $('bloqueoLista').onclick(clic('data-quitar', c));
    revisar('quitar la zona elegida limpia la elección', !$('bloqueoLista').innerHTML.includes('aria-pressed="true"'));
    const radioB = pieza.bloqueos[0].radio;
    $('bloqueoRadioMas').onclick();
    revisar('sin elegida el stepper no toca la zona que queda', pieza.bloqueos[0].radio === radioB);
    $('bloqueoLista').onclick(clic('data-quitar', b));
}

function firma(t) {
    const { revisar, pieza, visor, ui, avisos } = t;
    console.log('\n▶ bloqueos-ui: cambio de firma');
    visor.fn({ id: pieza.id, punto: { x: 1, y: 2, z: 3 } });
    visor.fn({ id: pieza.id, punto: { x: 4, y: 5, z: 6 } });
    ui.sincronizar();
    revisar('con la misma firma sincronizar no vacía', pieza.bloqueos.length === 2 && avisos.length === 0);
    pieza.escala = 2;
    ui.sincronizar();
    revisar('si cambia la escala se vacían las zonas', pieza.bloqueos.length === 0 && pieza.firmaBloqueos === null);
    revisar('con el aviso exacto', avisos.at(-1) === 'Se quitaron las zonas sin soporte porque cambió la pieza');
    pieza.escala = 1;
    visor.fn({ id: pieza.id, punto: { x: 1, y: 2, z: 3 } });
    pieza.rotacion = [0, 1, 0, -1, 0, 0, 0, 0, 1];
    ui.sincronizar();
    revisar('si cambia la rotación también', pieza.bloqueos.length === 0 && avisos.length === 2);
    ui.sincronizar();
    revisar('sin zonas no vuelve a avisar', avisos.length === 2);
}

function limite(t) {
    const { revisar, $, pieza, visor } = t;
    console.log('\n▶ bloqueos-ui: límite');
    pieza.rotacion = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    pieza.escala = 1;
    if ($('bloqueoMarcar').getAttribute('aria-pressed') !== 'true') $('bloqueoMarcar').onclick();
    const enganchado = visor.fn; // el toque que el visor todavía tiene enganchado antes de llenar
    for (let i = 0; i < MAX_BLOQUEOS + 5; i++) visor.fn?.({ id: pieza.id, punto: { x: i, y: 0, z: 1 } });
    revisar(`no pasa de ${MAX_BLOQUEOS} zonas`, pieza.bloqueos.length === MAX_BLOQUEOS);
    revisar(
        'el botón de marcar queda deshabilitado y sin modo',
        $('bloqueoMarcar').disabled && $('bloqueoMarcar').getAttribute('aria-pressed') === 'false',
    );
    revisar('el visor suelta el toque', visor.fn === null);
    enganchado({ id: pieza.id, punto: { x: 99, y: 0, z: 1 } });
    revisar('un toque rezagado con el tope alcanzado no agrega', pieza.bloqueos.length === MAX_BLOQUEOS);
    revisar('explica el tope', $('bloqueoAyuda').textContent.includes(`Máximo ${MAX_BLOQUEOS} zonas`));
    $('bloqueoLista').onclick(clic('data-quitar', pieza.bloqueos[0].id));
    revisar('al quitar una se puede volver a marcar', !$('bloqueoMarcar').disabled);
}

function dosPiezas(t) {
    const { revisar, estado, avisos, ui, visor } = t;
    const { crearPieza, firmaPieza } = t.m;
    console.log('\n▶ bloqueos-ui: sincronizar con dos piezas');
    const nueva = () => {
        const p = crearPieza({ nombre: 'x.stl', stl: new ArrayBuffer(0), vista: {} });
        p.bloqueos = [{ id: p.id * 10, forma: 'esfera', centro: { x: 0, y: 0, z: 1 }, radio: 5 }];
        p.firmaBloqueos = firmaPieza(p);
        return p;
    };
    const [p1, p2] = [nueva(), nueva()];
    estado.piezas = [p1, p2];
    estado.activa = p1.id;
    const antes = avisos.length;
    p2.escala = 3; // cambia la que NO es la activa
    ui.sincronizar();
    revisar('solo se vacía la pieza que cambió', p1.bloqueos.length === 1 && p2.bloqueos.length === 0);
    revisar('y avisa una sola vez', avisos.length === antes + 1);
    revisar('la activa sigue en el visor con sus marcas', visor.marcas.at(-1).zonas.length === 1);
}

function texto(t) {
    const { revisar, $, nuevaPieza } = t;
    const { ui } = t;
    const { NOTA_VOLADIZO } = t.m;
    const { chipZona } = t.m;
    console.log('\n▶ bloqueos-ui: texto y piezas sin zonas');
    const chip = chipZona({ id: 1, radio: 8 }, 1, '<img src=x onerror=alert(1)>.stl', false);
    revisar('la chip escapa el nombre de la pieza', !chip.includes('<img') && chip.includes('&#60;img'));
    nuevaPieza('torre');
    ui.dibujar();
    revisar('el panel avisa del voladizo', $('bloqueoNota').textContent === NOTA_VOLADIZO);
    revisar('con torre el panel se oculta', $('bloqueosPanel').hidden === true);
    nuevaPieza('litofania');
    ui.dibujar();
    revisar('con litofanía también', $('bloqueosPanel').hidden === true);
}

function tipo(t) {
    const { revisar, estado, $, nuevaPieza } = t;
    const { crearTipoSoportes } = t.m;
    console.log('\n▶ soportes-tipo-ui');
    nuevaPieza();
    estado.piezas[0].bloqueos = [{ id: 1 }, { id: 2 }];
    const tipo = crearTipoSoportes({ alCambiar: () => t.guardados++ });
    tipo.conectar();
    estado.soportes = true; // preferencia vieja
    tipo.dibujar();
    tipo.conectar();
    revisar('conectar dos veces cablea una sola vez', $('tipoSoportes').nAdd === 1);
    revisar("un boolean viejo se dibuja como 'normal'", /value="normal"[^>]*checked/.test($('tipoSoportes').innerHTML));
    revisar(
        'hay tres opciones con ayuda',
        ($('tipoSoportes').innerHTML.match(/type="radio"/g) ?? []).length === 3 &&
            $('tipoSoportes').innerHTML.includes('ayudaSoportes-arbol'),
    );
    revisar(
        'con tipo normal y 2 zonas dice "2 zonas sin soporte"',
        $('tipoSoportesZonas').textContent === '2 zonas sin soporte',
    );
    const html = $('tipoSoportes').innerHTML;
    const cambiar = valor => $('tipoSoportes').oyentes.change({ target: { name: 'tipoSoportes', value: valor } });
    cambiar('arbol');
    revisar("elegir Árbol guarda 'arbol' y avisa alCambiar", estado.soportes === 'arbol' && t.guardados === 1);
    revisar('al cambiar no se redibujan los radios (el foco no se pierde)', $('tipoSoportes').innerHTML === html);
    revisar(
        'la ayuda de cada radio está fuera del label',
        !(html.match(/<label[^]*?<\/label>/g) ?? []).some(l => l.includes('<small')) &&
            html.includes('aria-describedby'),
    );
    t.tipo = tipo;
    t.html = html;
    tipo2(t);
}

function tipo2(t) {
    const { revisar, estado, $, J, tipo, html } = t;
    const cambiar = valor => $('tipoSoportes').oyentes.change({ target: { name: 'tipoSoportes', value: valor } });
    cambiar('no');
    revisar(
        "con 'no' no hay aviso de zonas",
        $('tipoSoportesZonas').textContent === '' && $('tipoSoportesZonas').hidden !== true,
    );
    cambiar('cualquiera');
    revisar("un valor raro se normaliza a 'no'", estado.soportes === 'no');
    estado.piezas[0].bloqueos = [{ id: 1 }];
    cambiar('normal');
    revisar('con una zona dice "1 zona sin soporte"', $('tipoSoportesZonas').textContent === '1 zona sin soporte');
    estado.soportes = 'arbol';
    tipo.dibujar();
    const marcados = $('tipoSoportes')
        .querySelectorAll('input')
        .filter(r => r.checked)
        .map(r => r.value);
    revisar(
        'dibujar de nuevo solo marca el tipo vigente',
        J(marcados) === J(['arbol']) && $('tipoSoportes').innerHTML === html,
    );
    estado.soportes = 'normal';
    $('tipoSoportes').oyentes.change({ target: { name: 'otro', value: 'arbol' } });
    revisar('un cambio de otro control no toca el tipo', estado.soportes === 'normal');
}

export default async function ({ revisar }) {
    const m = await cargar();
    const dom = crearDom();
    const t = {
        revisar,
        m,
        dom,
        $: dom.$,
        J: JSON.stringify,
        estado: m.estado,
        avisos: [],
        cambios: 0,
        guardados: 0,
        visor: crearVisor(),
    };
    let ids = 0;
    t.nuevaPieza = (origen = 'modelo') => {
        const p = m.crearPieza({ nombre: 'cubo.stl', stl: new ArrayBuffer(0), vista: {}, origen });
        p.posiciones = [
            { x: -30, y: 0 },
            { x: 30, y: 0 },
        ];
        m.estado.piezas = [p];
        m.estado.activa = p.id;
        return p;
    };
    t.ui = m.crearBloqueosUI({
        visor: () => t.visor,
        avisar: msg => t.avisos.push(msg),
        nuevoId: () => ++ids,
        alCambiar: () => t.cambios++,
    });
    t.pieza = t.nuevaPieza();
    t.ui.conectar();
    t.ui.dibujar();
    for (const seccion of [agregar, radio, quitar, firma, limite, dosPiezas, texto, tipo]) seccion(t);
}
