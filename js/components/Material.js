import * as THREE from "three";

/**
 * Classe para representar materiais de superfície
 */
class Material {
   constructor(name, properties) {
      this.name = name;
      this.friction = properties.friction || 1.0;
      this.restitution = properties.restitution || 0.3;
      this.color = properties.color || 0xaaaaaa;
      this.roughness = properties.roughness || 0.5;
      this.metalness = properties.metalness || 0.0;
      this.texture = properties.texture || null;
   }
   
   createMaterial() {
      const material = new THREE.MeshStandardMaterial({
         color: this.color,
         roughness: this.roughness,
         metalness: this.metalness
      });
      
      if (this.texture) {
         const textureLoader = new THREE.TextureLoader();
         const loadedTexture = textureLoader.load(this.texture);
         material.map = loadedTexture;
         
         // Adicionar textura de rugosidade se disponível
         if (this.roughnessMap) {
            material.roughnessMap = textureLoader.load(this.roughnessMap);
         }
      }
      
      return material;
   }
   
   applyToMesh(mesh) {
      mesh.material = this.createMaterial();
   }
}

/**
 * Biblioteca de materiais disponíveis no jogo
 */
export class MaterialLibrary {
   static materials = {
      asphalt: new Material("asphalt", {
         friction: 1.0,
         restitution: 0.3,
         color: 0x333333,
         roughness: 0.9,
         texture: "textures/asphalt.jpg"
      }),
      
      dirt: new Material("dirt", {
         friction: 0.6,
         restitution: 0.2,
         color: 0x8B4513,
         roughness: 1.0,
         texture: "textures/dirt.jpg"
      }),
      
      ice: new Material("ice", {
         friction: 0.1,
         restitution: 0.8,
         color: 0xADD8E6,
         roughness: 0.1,
         metalness: 0.2,
         texture: "textures/ice.jpg"
      }),
      
      grass: new Material("grass", {
         friction: 0.7,
         restitution: 0.4,
         color: 0x4CAF50,
         roughness: 0.8,
         texture: "textures/grass.jpg"
      }),
      
      sand: new Material("sand", {
         friction: 0.4,
         restitution: 0.1,
         color: 0xF4A460,
         roughness: 1.0,
         texture: "textures/sand.jpg"
      }),
   };
   
   static getMaterial(name) {
      return this.materials[name] || this.materials.asphalt;
   }
}

export default Material;