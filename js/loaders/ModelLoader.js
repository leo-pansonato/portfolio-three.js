import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

class ModelLoader {
   constructor() {
      this.loader = new GLTFLoader();
   }

   async loadModel(path, scale = {x: 1, y: 1, z: 1}) {
      return new Promise((resolve, reject) => {
         this.loader.load(
            path,
            (gltf) => {
               const model = gltf.scene;
               model.scale.set(scale.x, scale.y, scale.z);
               resolve(model);
            },
            (xhr) => {
               console.log("Modelo "+(xhr.loaded / xhr.total * 100) + '% carregado');
            },
            (error) => {
               console.error('Erro ao carregar modelo:', error);
               reject(error);
            }
         );
      });
   }
}

export default ModelLoader;
