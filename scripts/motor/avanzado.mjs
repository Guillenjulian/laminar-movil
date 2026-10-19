// Opciones avanzadas (laminado en Chromium): cada una tiene que verse en el G-code. Van en personal.avanzado (como las
// pasa la app) y sin adhesión, para medir sólo la pieza.
// Jarrón (espiral, sin relleno, vista previa), altura de capa variable, temperatura / ventilador / retracción / z-hop /
// velocidad manuales, costura (atrás y al azar) y compensación de agujeros y contorno.
// Recibe `base` (cubo por defecto) y `nada` (cubo sin adhesión) de `probarPersonalizar`.

import { leerRecorridos, movimientos, capaDe, filamento } from './ayudas.mjs';

// Jarrón: una sola pared, sin relleno y la Z sube de a poco dentro de cada vuelta.
async function probarJarron({ av, revisar, base }) {
    const jarron = await av({ jarron: true });
    const capa50 = movimientos(capaDe(jarron, 50)).filter(m => m.e > 0 && m.xy);
    const zs50 = capa50.map(m => m.z);
    revisar('jarrón: una sola pared (4 tramos por vuelta del cubo)', capa50.length === 4, `${capa50.length} tramos`);
    revisar(
        'jarrón: Z sube dentro de la capa (espiral)',
        zs50.every((z, i) => i === 0 || z > zs50[i - 1]) && Math.abs(zs50.at(-1) - zs50[0] - 0.15) < 0.01,
        `Z ${zs50.join(' → ')}`,
    );
    const rellenos = jarron.g.lineas.filter(l => /^; feature (sparse|solid)/.test(l)).length;
    revisar(
        'jarrón: sin relleno (sólo el fondo)',
        rellenos <= 3 && !jarron.g.tiene('; feature sparse') && jarron.info.filamento < base.info.filamento / 3,
        `${rellenos} capas de fondo, ${filamento(jarron)}`,
    );
    const vueltas = jarron.g.lineas.filter(l => l === '; capa en espiral').length;
    const lectura = leerRecorridos(jarron.gcode, Infinity);
    revisar(
        'jarrón: la vista previa ve una capa por vuelta',
        vueltas > 90 && Math.abs(lectura.zCapa.length - jarron.g.capas) <= 1,
        `${vueltas} vueltas, ${lectura.zCapa.length} capas en la vista previa`,
    );
}

// Altura de capa variable: en una esfera tiene que haber capas de distintas alturas.
async function probarAlturaVariable({ av, revisar }) {
    const alturas = r => {
        const zs = Array.from(leerRecorridos(r.gcode, Infinity).zCapa);
        return [...new Set(zs.slice(1).map((z, i) => +(z - zs[i]).toFixed(2)))].sort((a, b) => a - b);
    };
    const esferaFija = await av({}, 'esferaChica');
    const esferaVariable = await av({ alturaVariable: true }, 'esferaChica');
    const hv = alturas(esferaVariable);
    revisar('altura fija: todas las capas de 0,2 mm', alturas(esferaFija).length === 1, alturas(esferaFija).join(', '));
    revisar(
        'altura variable: capas de distintas alturas (máx ≈ 0,2 mm)',
        hv.length >= 3 && Math.min(...hv) < 0.19 && Math.max(...hv) <= 0.22,
        `${hv.join(', ')} mm (${esferaFija.g.capas} → ${esferaVariable.g.capas} capas)`,
    );
    const zv = leerRecorridos(esferaVariable.gcode, Infinity).zCapa;
    revisar(
        'altura variable: primera capa en 0,2 mm, una Z por capa y 20 mm de alto',
        Math.abs(zv[0] - 0.2) < 0.001 &&
            Math.abs(zv.length - esferaVariable.g.capas) <= 1 &&
            Math.abs(zv.at(-1) - 20) < 0.25,
        `Z ${zv[0].toFixed(2)} … ${zv.at(-1).toFixed(2)}, ${zv.length} capas`,
    );
}

// Temperatura, ventilador, retracción, z-hop y velocidad juntos en un cubo.
async function probarAjustes({ av, revisar, nada }) {
    const ajustes = await av({
        tempBoquilla: 215,
        tempCama: 70,
        ventilador: 50,
        retraccion: 1.5,
        zHop: 0.4,
        velocidad: 50,
    });
    revisar(
        'temperatura manual: M104/M109 S215 y cama 70',
        ajustes.g.tiene('M104 S215') &&
            ajustes.g.tiene('M109 S215') &&
            ajustes.g.tiene('M190 S70') &&
            !ajustes.g.tiene('M104 S200'),
    );
    revisar('ventilador al 50 %: M106 S128', ajustes.g.tiene('M106 S128') && !ajustes.g.tiene('M106 S255'));
    revisar('retracción de 1,5 mm', ajustes.g.tiene('G1 E-1.5') && !ajustes.g.tiene('G1 E-0.8'));
    const hops = ajustes.g.lineas.filter(l => /^G1 Z[\d.]+ .*z-hop start/.test(l)).length;
    const subidaHop = (() => {
        const l = ajustes.g.lineas,
            i = l.findIndex(x => x.includes('z-hop start')),
            j = l.findIndex((x, k) => k > i && x.includes('z-hop end'));
        return +(+l[i].match(/Z([\d.]+)/)[1] - +l[j].match(/Z([\d.]+)/)[1]).toFixed(3);
    })();
    revisar('z-hop: sube 0,4 mm en los viajes', hops > 5 && subidaHop === 0.4, `${hops} subidas de ${subidaHop} mm`);
    const velMax = r =>
        Math.max(
            ...movimientos(r.g.lineas.slice(r.g.lineas.indexOf(';LAYER:1')))
                .filter(m => m.e > 0 && m.xy)
                .map(m => m.f),
        );
    revisar(
        'velocidad al 50 %: extrusiones más lentas',
        velMax(ajustes) <= velMax(nada) / 2 + 1,
        `F máx ${velMax(nada)} → ${velMax(ajustes)}`,
    );
    const sinHop = movimientos(nada.g.lineas).some(m => m.linea.includes('z-hop'));
    revisar('sin z-hop por defecto (la Ender no lo usa)', !sinHop);
}

// Costura "Atrás": cada capa arranca en el fondo de la pieza (Y alta, el cubo va de 100 a 120).
async function probarCostura({ av, revisar }) {
    const inicios = r =>
        Array.from({ length: 20 }, (_, k) => movimientos(capaDe(r, 20 + k)).find(m => m.e > 0 && m.xy));
    const inicioCapas = r => inicios(r).map(m => m.y0);
    const atras = await av({ costura: 'atras' });
    revisar(
        'costura atrás: las capas empiezan en el fondo',
        inicioCapas(atras).every(y => y > 118),
        `Y ${inicioCapas(atras).join(', ')}`,
    );
    const azar = await av({ costura: 'azar' });
    const lugares = new Set(inicios(azar).map(m => `${m.x0.toFixed(0)},${m.y0.toFixed(0)}`));
    revisar('costura al azar: empiezan en lugares distintos', lugares.size >= 3, `(${[...lugares].join(') (')})`);
}

// Compensación: un tubo de 20 mm con un agujero de 10 mm. Medimos la primera capa:
// la mitad del ancho de afuera y del agujero (las extrusiones más lejanas y más cercanas al centro).
async function probarCompensacion({ av, revisar }) {
    const medidas = r => {
        const pts = movimientos(capaDe(r, 0))
            .filter(m => m.e > 0 && m.xy)
            .flatMap(m => [
                [m.x0, m.y0],
                [m.x, m.y],
            ]);
        const d = pts.map(([x, y]) => Math.max(Math.abs(x - 110), Math.abs(y - 110)));
        return { afuera: 2 * Math.max(...d), agujero: 2 * Math.min(...d) };
    };
    const tubo = medidas(await av({}, 'tubo'));
    const tuboMas = medidas(await av({ compAgujeros: 0.4, compExterior: 0.4 }, 'tubo'));
    const tuboMenos = medidas(await av({ compAgujeros: -0.4, compExterior: -0.4 }, 'tubo'));
    const ver = m => `afuera ${m.afuera.toFixed(2)}, agujero ${m.agujero.toFixed(2)}`;
    revisar(
        'compensación +0,4: agranda el agujero y el contorno 0,4 mm',
        Math.abs(tuboMas.agujero - tubo.agujero - 0.4) < 0.02 && Math.abs(tuboMas.afuera - tubo.afuera - 0.4) < 0.02,
        `${ver(tubo)} → ${ver(tuboMas)}`,
    );
    revisar(
        'compensación −0,4: achica el agujero y el contorno 0,4 mm',
        Math.abs(tubo.agujero - tuboMenos.agujero - 0.4) < 0.02 &&
            Math.abs(tubo.afuera - tuboMenos.afuera - 0.4) < 0.02,
        ver(tuboMenos),
    );
}

export async function probarAvanzado({ laminar, revisar, base, nada }) {
    const av = (avanzado, caso = 'cubo') => laminar({ caso, personal: { adhesion: 'nada', avanzado } });
    await probarJarron({ av, revisar, base });
    await probarAlturaVariable({ av, revisar });
    await probarAjustes({ av, revisar, nada });
    await probarCostura({ av, revisar });
    await probarCompensacion({ av, revisar });
}
