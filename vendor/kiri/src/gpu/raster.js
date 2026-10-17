// shim: RasterPath (WebGPU) sólo se usa en CAM. No aplica a FDM.
export class RasterPath {
    constructor() { throw new Error('RasterPath no está disponible en laminar-movil (sólo CAM)'); }
}
