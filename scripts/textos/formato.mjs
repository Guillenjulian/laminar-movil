// Pruebas de src/ui/formato.js (ADR 0008, I4): cada función en es (es-AR) y en en (en-US), con aserciones exactas.
// Usa los diccionarios reales de src/textos/{es,en}/formato.json y, aparte, diccionarios sintéticos para probar que
// los textos salen de t() en el momento de cada llamada.
import { readFileSync } from 'node:fs';
import { ponerDiccionarios } from '../../src/ui/idioma.js';
import {
    bytes,
    duracion,
    filamento,
    gramos,
    milimetros,
    numero,
    numeroHasta,
    pesos,
    triangulos,
} from '../../src/ui/formato.js';

const leer = idioma =>
    JSON.parse(readFileSync(new URL(`../../src/textos/${idioma}/formato.json`, import.meta.url), 'utf8'));
const ES = leer('es');
const EN = leer('en');

const comprobar = (revisar, igual) => (nombre, real, esperado) =>
    revisar(nombre, igual(real, esperado), `(real: ${JSON.stringify(real)})`);

function pruebasEs(en) {
    ponerDiccionarios('es', ES, ES);
    en(
        'es numero',
        [numero(1234.5, 1), numero(1234567), numero(0.5, 2), numeroHasta(1234.56, 1), numeroHasta(2, 2)],
        ['1.234,5', '1.234.567', '0,50', '1.234,6', '2'],
    );
    en(
        'es numeroHasta no rellena',
        [numeroHasta(0.05, 2), numeroHasta(1.5, 2), numeroHasta(225, 0)],
        ['0,05', '1,5', '225'],
    );
    en('es milimetros', milimetros({ x: 1234.5, y: 20, z: 3.25 }), '1.234,5 × 20,0 × 3,3 mm');
    en(
        'es triangulos',
        [triangulos(1), triangulos(2), triangulos(1234), triangulos(12345), triangulos(2500000)],
        ['1 triángulo', '2 triángulos', '1.234 triángulos', '12 mil triángulos', '2,5 millones de triángulos'],
    );
    en('es duracion', [duracion(120), duracion(3600), duracion(7325)], ['2 min', '1 h 0 min', '2 h 2 min']);
    en('es gramos', Math.round(gramos(1000) * 1000), 2983);
    en('es filamento', filamento(12345), '12,35 m (≈ 37 g)');
    en('es pesos', [pesos(1234.4), pesos(1234567)], ['$ 1.234', '$ 1.234.567']);
    en('es bytes', [bytes(10), bytes(1234567), bytes(2500000)], ['1 KB', '1,2 MB', '2,5 MB']);
}

function pruebasEn(en) {
    ponerDiccionarios('en', EN, ES);
    en(
        'en numero',
        [numero(1234.5, 1), numero(1234567), numero(0.5, 2), numeroHasta(1234.56, 1), numeroHasta(2, 2)],
        ['1,234.5', '1,234,567', '0.50', '1,234.6', '2'],
    );
    en(
        'en numeroHasta no rellena',
        [numeroHasta(0.05, 2), numeroHasta(1.5, 2), numeroHasta(225, 0)],
        ['0.05', '1.5', '225'],
    );
    en('en milimetros', milimetros({ x: 1234.5, y: 20, z: 3.25 }), '1,234.5 × 20.0 × 3.3 mm');
    en(
        'en triangulos',
        [triangulos(1), triangulos(2), triangulos(1234), triangulos(12345), triangulos(2500000)],
        ['1 triangle', '2 triangles', '1,234 triangles', '12k triangles', '2.5 million triangles'],
    );
    en('en duracion', [duracion(120), duracion(3600), duracion(7325)], ['2 min', '1 h 0 min', '2 h 2 min']);
    en('en filamento', filamento(12345), '12.35 m (≈ 37 g)');
    en('en pesos', [pesos(1234.4), pesos(1234567)], ['ARS 1,234', 'ARS 1,234,567']);
    en('en bytes', [bytes(10), bytes(1234567), bytes(2500000)], ['1 KB', '1.2 MB', '2.5 MB']);
}

function pruebasSinteticas(en) {
    // Sintéticos: los textos salen de t() en cada llamada, y el cambio de idioma se nota en la llamada siguiente.
    const SES = {
        'formato.pesos': 'PESOS {n}',
        'formato.bytes.kb': 'k{n}',
        'formato.duracion.minutos': 'm{min}',
    };
    const SEN = {
        'formato.pesos': 'DOLLARS {n}',
        'formato.bytes.kb': 'kb{n}',
        'formato.duracion.minutos': 'min{min}',
    };
    ponerDiccionarios('es', SES, SES);
    en('sintético es', [pesos(1500), bytes(5000), duracion(60)], ['PESOS 1.500', 'k5', 'm1']);
    ponerDiccionarios('en', SEN, SES);
    en('sintético en', [pesos(1500), bytes(5000), duracion(60)], ['DOLLARS 1,500', 'kb5', 'min1']);
    ponerDiccionarios('es', SES, SES);
    en('vuelve a es sin recargar', pesos(1500), 'PESOS 1.500');
}

export default async function ({ revisar, igual }) {
    const en = comprobar(revisar, igual);
    pruebasEs(en);
    pruebasEn(en);
    pruebasSinteticas(en);
}
