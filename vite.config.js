import { defineConfig } from 'vite';

export default defineConfig({
    // Rutas relativas: así el build funciona tanto en la raíz de un dominio
    // (Cloudflare Pages) como en un subdirectorio (GitHub Pages /laminar-movil/).
    base: './',
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
