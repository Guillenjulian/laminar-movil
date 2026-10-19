// Pruebas de src/red/cliente.js (ADR 0007, 6.4): el contexto que el cliente le pasa a errores.js (clave, imprimir,
// http) y lo que le pasa a la sonda. Cada caso falla si se rompe esa pieza (mutaciones verificadas a mano).
import { probar } from './lib/impresora-falsa.mjs';

const TIPOS = ['octoprint', 'moonraker'];
const texto = r => `${r.valor?.error?.mensaje} ${r.valor?.error?.pista}`;

async function pruebaClave(c, tipo, revisar) {
    const con = await probar(c, tipo, { clave: 'la-buena', config: { claveApi: 'la-mala' } });
    const sin = await probar(c, tipo, { clave: 'la-buena' });
    revisar('clave mala con clave configurada: "no sirve"', /no sirve/.test(texto(con)), texto(con));
    revisar('sin clave configurada: "pide una API key"', /pide una API key/.test(texto(sin)), texto(sin));
}

async function pruebaImprimirYHttp(c, tipo, revisar) {
    const lectura = await probar(c, tipo, { modo: 'cors', config: { imprimir: true } });
    revisar('probar con imprimir=true no avisa "haya llegado"', !/haya llegado/.test(texto(lectura)), texto(lectura));
    const http = await probar(c, tipo, { modo: 'sin-red' });
    const https = await probar(c, tipo, { modo: 'sin-red', config: { direccion: 'https://192.168.1.50' } });
    revisar('http sin llegada: pista de http', /Puede estar apagada/.test(texto(http)), texto(http));
    revisar('https sin llegada: pista del certificado', /certificado/.test(texto(https)), texto(https));
    revisar(
        'la sonda recibe el origen, sin ruta',
        http.f.sondeadas.length === 1 && http.f.sondeadas[0] === 'http://192.168.1.50',
        http.f.sondeadas.join(),
    );
    const direccion = 'http://192.168.1.50:5000/octoprint';
    const conRuta = await probar(c, tipo, { modo: 'cors', config: { direccion } });
    revisar(
        'dirección con ruta y puerto: la sonda recibe exactamente el origen',
        conRuta.f.sondeadas.length === 1 && conRuta.f.sondeadas[0] === 'http://192.168.1.50:5000',
        conRuta.f.sondeadas.join(),
    );
}

export default async function ({ revisar, cargar }) {
    const c = await cargar('cliente');
    if (!c) return;
    for (const tipo of TIPOS) {
        console.log(`\ncontexto de los errores (${tipo})`);
        await pruebaClave(c, tipo, revisar);
        await pruebaImprimirYHttp(c, tipo, revisar);
        const rara = await probar(c, tipo, { respuestas: { estado: { estado: 200, texto: '{}' } } });
        revisar('estado ilegible: ok con ocupada=null', rara.valor?.ok === true && rara.valor.resumen.ocupada === null);
    }
}
