import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Genera dist/sw.js a partir de src/sw.js con la lista de todos los archivos
// del build, para que la app quede guardada entera y funcione offline.
function serviceWorker() {
    let salida;
    return {
        name: 'laminar-service-worker',
        apply: 'build',
        configResolved(config) {
            salida = path.resolve(config.root, config.build.outDir);
        },
        writeBundle() {
            const archivos = [];
            const hash = createHash('sha256');
            const recorrer = dir => {
                for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
                    const ruta = path.join(dir, f.name);
                    if (f.isDirectory()) recorrer(ruta);
                    else {
                        const rel = path.relative(salida, ruta).split(path.sep).join('/');
                        // La página de diagnóstico no hace falta offline.
                        if (rel === 'sw.js' || rel.startsWith('prueba-motor') || rel.includes('pruebaMotor')) continue;
                        archivos.push(rel === 'index.html' ? './' : rel);
                        hash.update(rel).update(fs.readFileSync(ruta));
                    }
                }
            };
            recorrer(salida);
            archivos.sort();
            const codigo = fs
                .readFileSync(path.resolve('src/sw.js'), 'utf8')
                .replace('self.__ARCHIVOS__', JSON.stringify(archivos, null, 4))
                .replace('self.__VERSION__', JSON.stringify(hash.digest('hex').slice(0, 12)));
            fs.writeFileSync(path.join(salida, 'sw.js'), codigo);
        },
    };
}

export default defineConfig({
    // Rutas relativas: así el build funciona tanto en la raíz de un dominio
    // (Vercel, Cloudflare Pages) como en un subdirectorio (GitHub Pages /laminar-movil/).
    base: './',
    plugins: [serviceWorker()],
    worker: {
        // El worker de Kiri usa imports ES, así que el bundle del worker también.
        format: 'es',
    },
    build: {
        target: 'es2022',
        rollupOptions: {
            input: {
                main: 'index.html',
                pruebaMotor: 'prueba-motor.html',
            },
        },
    },
});
