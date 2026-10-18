import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
    {
        ignores: ['node_modules/', 'dist/', 'vendor/', 'public/', 'capturas/', 'src/perfiles/impresoras/kiri/'],
    },
    js.configs.recommended,
    {
        languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
        rules: {
            'no-unused-vars': [
                'error',
                {
                    args: 'after-used',
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
            'max-lines': ['warn', { max: 300, skipBlankLines: true, skipComments: true }],
            'max-lines-per-function': ['warn', { max: 40, skipBlankLines: true, skipComments: true }],
        },
    },
    {
        files: ['src/**/*.js'],
        ignores: ['src/**/*.worker.js', 'src/sw.js'],
        languageOptions: { globals: globals.browser },
    },
    {
        files: ['scripts/**'],
        // node + browser: los page.evaluate() de las pruebas usan document/window dentro de Chromium.
        languageOptions: { globals: { ...globals.node, ...globals.browser } },
    },
    {
        files: ['vite.config.js', 'eslint.config.js'],
        languageOptions: { globals: globals.node },
    },
    { files: ['src/**/*.worker.js'], languageOptions: { globals: globals.worker } },
    { files: ['src/sw.js'], languageOptions: { globals: globals.serviceworker } },
    prettier,
];
