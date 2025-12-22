import * as THREE from "three";

interface MaterialOptions {
  friction?: number;
  restitution?: number;
  color?: number | string;
  roughness?: number;
  metalness?: number;
  texture?: string | null;
  roughnessMap?: string;
}

/**
 * Classe para representar materiais de superfície
 */
class Material {
  public name: string;
  public friction: number;
  public restitution: number;
  public color: number | string;
  public roughness: number;
  public metalness: number;
  public texture: string | null;
  public roughnessMap?: string;

  constructor(name: string, properties: MaterialOptions) {
    this.name = name;
    this.friction = properties.friction || 1.0;
    this.restitution = properties.restitution || 0.3;
    this.color = properties.color || 0xaaaaaa;
    this.roughness = properties.roughness || 0.5;
    this.metalness = properties.metalness || 0.0;
    this.texture = properties.texture || null;
    this.roughnessMap = properties.roughnessMap;
  }

  createMaterial(): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.color as THREE.ColorRepresentation),
      roughness: this.roughness,
      metalness: this.metalness,
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

  applyToMesh(mesh: THREE.Mesh): void {
    mesh.material = this.createMaterial();
  }
}

/**
 * Biblioteca de materiais disponíveis no jogo
 */
export class MaterialLibrary {
  static materials: { [key: string]: Material } = {
    asphalt: new Material("asphalt", {
      friction: 1.0,
      restitution: 0.3,
      color: 0x333333,
      roughness: 0.9,
      texture: "textures/asphalt.jpg",
    }),

    dirt: new Material("dirt", {
      friction: 0.6,
      restitution: 0.2,
      color: 0x8b4513,
      roughness: 1.0,
      texture: "textures/dirt.jpg",
    }),

    ice: new Material("ice", {
      friction: 0.1,
      restitution: 0.8,
      color: 0xadd8e6,
      roughness: 0.1,
      metalness: 0.2,
      texture: "textures/ice.jpg",
    }),

    grass: new Material("grass", {
      friction: 0.7,
      restitution: 0.4,
      color: 0x4caf50,
      roughness: 0.8,
      texture: "textures/grass.jpg",
    }),

    sand: new Material("sand", {
      friction: 0.4,
      restitution: 0.1,
      color: 0xf4a460,
      roughness: 1.0,
      texture: "textures/sand.jpg",
    }),
  };

  static getMaterial(name: string): Material {
    return this.materials[name] || this.materials.asphalt;
  }
}

export default Material;