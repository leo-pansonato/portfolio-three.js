import * as THREE from "three";
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

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
   async loadModel(path, scale = {x: 1, y: 1, z: 1}) {
      const cacheKey = `${path}_${JSON.stringify(scale)}`;
      
      // Verificar se o modelo já está em cache
      if (this.loadingCache[cacheKey]) {
         return this.loadingCache[cacheKey].clone();
      }
      
      // Verificar se o arquivo existe
      try {
         const response = await fetch(path, { method: 'HEAD' });
         if (!response.ok) {
            console.warn(`Arquivo não encontrado: ${path}`);
            throw new Error("Arquivo não encontrado");
         }
      } catch (error) {
         console.warn(`Não foi possível verificar o arquivo: ${path}`);
      }
      
      // Carregar o modelo
      return new Promise((resolve, reject) => {
         this.loader.load(
            path,
            (gltf) => {
               try {
                  const model = gltf.scene;
                  
                  // Aplicar escala
                  model.scale.set(scale.x, scale.y, scale.z);
                  
                  // Armazenar no cache
                  this.loadingCache[cacheKey] = model.clone();
                  
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
               console.error('Erro ao carregar modelo:', error);
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
