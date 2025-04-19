import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

class ModelLoader {
   constructor() {
      this.loader = new GLTFLoader();
      this.loadingCache = {};
   }

   /**
    * Carrega um modelo 3D com tratamento de erros e caching
    * @param {String} path Caminho do modelo
    * @param {Object} scale Escala a ser aplicada
    * @returns {Promise<THREE.Group>} Modelo carregado
    */
   async loadModel(path, scale = { x: 1, y: 1, z: 1 }) {
      const cacheKey = path;

      // Verificar se o modelo já está em cache
      if (this.loadingCache[cacheKey]) {
         const model = this.loadingCache[cacheKey].clone();
         model.scale.set(scale.x, scale.y, scale.z);
         return model;
      }
      
      // Carregar o modelo
      return new Promise((resolve, reject) => {
         this.loader.load(
            path,
            (gltf) => {
               try {
                  const model = gltf.scene;

                  // Armazenar no cache
                  this.loadingCache[cacheKey] = model.clone();

                  // Aplicar escala
                  model.scale.set(scale.x, scale.y, scale.z);

                  resolve(model);
               } catch (processError) {
                  console.error("Erro ao processar modelo:", processError);
                  reject(processError);
               }
            },
            (xhr) => {
               // Progresso do carregamento
               console.log(`Modelo ${path}: ${(xhr.loaded / xhr.total * 100).toFixed(1)}% carregado`);
            },
            (error) => {
               console.error("Erro ao carregar modelo:", error);
               reject(error);
            }
         );
      });
   }

   /**
    * Limpa o cache de modelos
    */
   clearCache() {
      this.loadingCache = {};
   }
}

export default ModelLoader;
