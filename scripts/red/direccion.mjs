// Pruebas de `normalizarDireccion` (ADR 0007, 6.1 y sección 5). Puro: sin red ni DOM.

const ok = (direccion, http, nombreSinLocal) => ({ ok: true, direccion, http, nombreSinLocal });

function aceptadas(n, revisar, igual) {
    console.log('\nnormalizarDireccion: lo que acepta');
    const casos = [
        ['192.168.1.50', ok('http://192.168.1.50', true, false)],
        ['http://192.168.1.50', ok('http://192.168.1.50', true, false)],
        ['  192.168.1.50  ', ok('http://192.168.1.50', true, false)],
        ['192.168.1.50:5000', ok('http://192.168.1.50:5000', true, false)],
        ['http://192.168.1.50:7125/', ok('http://192.168.1.50:7125', true, false)],
        ['http://192.168.1.50///', ok('http://192.168.1.50', true, false)],
        ['http://192.168.1.50/octoprint/', ok('http://192.168.1.50/octoprint', true, false)],
        ['http://192.168.1.50/OctoPrint', ok('http://192.168.1.50/OctoPrint', true, false)],
        ['HTTP://Octopi.LOCAL/', ok('http://octopi.local', true, false)],
        ['https://impresora.tail1234.ts.net', ok('https://impresora.tail1234.ts.net', false, false)],
        ['https://192.168.1.50:8443/', ok('https://192.168.1.50:8443', false, false)],
    ];
    for (const [texto, esperado] of casos) {
        revisar(`acepta ${JSON.stringify(texto)}`, igual(n(texto), esperado), JSON.stringify(n(texto)));
    }
}

function nombres(n, revisar) {
    console.log('\nnormalizarDireccion: http y nombreSinLocal (IP privada y .local detectados)');
    const sinLocal = texto => n(texto).nombreSinLocal;
    revisar('http://octopi: nombreSinLocal true', sinLocal('http://octopi') === true);
    revisar('http://impresora.lan: nombreSinLocal true', sinLocal('http://impresora.lan') === true);
    revisar('http://octopi.local: nombreSinLocal false', sinLocal('http://octopi.local') === false);
    revisar('http://192.168.0.2: nombreSinLocal false', sinLocal('http://192.168.0.2') === false);
    revisar('http://10.0.0.7:5000: nombreSinLocal false', sinLocal('http://10.0.0.7:5000') === false);
    revisar('https://x.ts.net: nombreSinLocal false', sinLocal('https://x.ts.net') === false);
    revisar('https://octopi: nombreSinLocal false (no es http)', sinLocal('https://octopi') === false);
    revisar(
        'http: true para http y false para https',
        n('x.local').http === true && n('https://x.local').http === false,
    );
}

function rechazadas(n, revisar) {
    console.log('\nnormalizarDireccion: lo que rechaza');
    const malas = [
        'javascript:alert(1)',
        'file:///x',
        'ftp://x',
        'data:text/html,hola',
        'http://user:pass@192.168.1.50',
        'http://user@192.168.1.50',
        'http://192.168.1.50?x=1',
        'http://192.168.1.50/?',
        'http://192.168.1.50#a',
        'http://192.168.1.50/octoprint#a',
        '',
        '   ',
        'http://',
        'http://exa mple.local',
    ];
    for (const texto of malas) {
        const r = n(texto);
        const bien = r.ok === false && typeof r.motivo === 'string' && r.motivo.length > 0;
        revisar(`rechaza ${JSON.stringify(texto)} con un motivo`, bien, JSON.stringify(r));
    }
    const r = n('http://usuario:SECRETO-XYZ@192.168.1.50');
    revisar(
        'el motivo no repite la contraseña escrita',
        r.ok === false && !String(r.motivo).includes('SECRETO-XYZ'),
        r.motivo,
    );
}

export default async function ({ revisar, igual, cargar }) {
    const modulo = await cargar('direccion');
    if (!modulo) return;
    // Un fallo inesperado de la función cuenta como falla del caso, no corta el resto.
    const n = texto => {
        try {
            return modulo.normalizarDireccion(texto);
        } catch (e) {
            return { ok: 'lanzó', motivo: e.message, direccion: undefined };
        }
    };
    aceptadas(n, revisar, igual);
    nombres(n, revisar);
    rechazadas(n, revisar);
}
