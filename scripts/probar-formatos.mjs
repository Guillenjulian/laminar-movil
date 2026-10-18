// Pruebas de los lectores de OBJ y 3MF, del escritor de STL y de la litofanía
// (corren en Node, sin navegador). Cada tema vive en scripts/formatos/.
//
// Uso: npm run test:formatos

import { probarObj, probarStl } from './formatos/obj-stl.mjs';
import { probar3mf } from './formatos/3mf.mjs';
import { probarErrores } from './formatos/errores.mjs';
import { probarLitofania } from './formatos/litofania.mjs';
import { probarMd5 } from './formatos/md5.mjs';
import { probarBambuXml } from './formatos/bambu-xml.mjs';

let fallas = 0;
function revisar(nombre, condicion, detalle = '') {
    console.log(`${condicion ? '  ✔' : '  ✘'} ${nombre} ${detalle}`);
    if (!condicion) fallas++;
}

const obj = await probarObj({ revisar });
probarStl({ revisar, obj });
await probar3mf({ revisar });
await probarErrores({ revisar });
await probarLitofania({ revisar });
probarMd5({ revisar });
await probarBambuXml({ revisar });

console.log(fallas ? `\n${fallas} PRUEBA(S) FALLARON` : '\nTODAS LAS PRUEBAS OK');
process.exit(fallas ? 1 : 0);
