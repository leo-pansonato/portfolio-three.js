import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

class ModelLoader {
   constructor() {
      this.loader = new GLTFLoader();
   }

   loadModel(url, scale = {x: 0.1, y: 0.1, z: 0.1}) {
      return new Promise((resolve, reject) => {
         this.loader.load(
            url,
            (gltf) => {
               // Ajustar a escala do modelo
               gltf.scene.scale.set(scale);
               resolve(gltf.scene);
            },
            (xhr) => {
               console.log((xhr.loaded / xhr.total) * 100 + "% carregado");
            },
            (error) => {
               console.error("An error occurred while loading the model:", error);
               reject(error);
            }
         );
      });
   }
}

export default ModelLoader;
