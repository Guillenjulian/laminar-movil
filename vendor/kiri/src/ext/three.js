// shim: upstream lo genera con webpack (bin/webpack-three-bundle.js)
import * as THREE_NS from 'three';
import * as SVGLoader from 'three/examples/jsm/loaders/SVGLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import * as MeshBVHLib from 'three-mesh-bvh';
// Kiri le agrega propiedades a THREE (add/three.js), así que tiene que ser un
// objeto común y no el namespace del módulo (que es inmutable).
const THREE = { ...THREE_NS };
export { THREE, SVGLoader, BufferGeometryUtils, LineMaterial, Line2, LineGeometry,
    LineSegments2, LineSegmentsGeometry, TrackballControls, MeshBVHLib };
