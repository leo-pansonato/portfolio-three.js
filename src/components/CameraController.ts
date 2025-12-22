import * as THREE from "three";
import GameComponent from "./GameComponent";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import InputManager from "../managers/InputManager";

// Interface para o objeto que a câmera vai seguir (geralmente o Player)
interface ITarget {
  getPosition(): THREE.Vector3;
  getMovimentDirection(): THREE.Vector3; // Mantive o typo original 'Moviment'
  getCurrentSpeed(): number;
}

/**
 * Controlador de câmera usando OrbitControls
 */
export default class CameraController extends GameComponent {
  private camera: THREE.PerspectiveCamera;
  private target: ITarget | null;
  private inputManager: InputManager;
  private orbitControls: OrbitControls;
  private lastTargetPosition: THREE.Vector3;
  
  // Propriedades adicionais inferidas do uso no InputManager
  public alwaysFollowTarget: boolean;
  public fixedCamera: boolean;
  public selectedCamera: any; 

  constructor(camera: THREE.PerspectiveCamera, target: any, inputManager: InputManager) {
    super();
    this.camera = camera;
    this.target = target;
    this.inputManager = inputManager;

    // Criar o controlador OrbitControls
    const domElement = document.getElementById("main");
    if(!domElement) throw new Error("DOM Element #main not found");

    this.orbitControls = new OrbitControls(this.camera, domElement);

    // Configurações iniciais
    this.setupControls();

    // Salvar a posição inicial do alvo para acompanhamento
    this.lastTargetPosition = new THREE.Vector3();
    if (this.target && this.target.getPosition) {
      this.lastTargetPosition.copy(this.target.getPosition());
    }

    // Forçar seguir o jogador
    this.alwaysFollowTarget = true;
    this.fixedCamera = true;

    this.selectedCamera = {
      ORBIT: { distance: 3, fov: 75 },
      NEAR: { distance: 2, fov: 75 },
      FAR: { distance: 5, fov: 60 },
      FIRST_PERSON: { distance: 0, fov: 75 },
    };

    // Posição inicial
    this.applyCameraPosition();
  }

  // Método inferido chamado pelo InputManager
  cycleCameraMode() {
      console.log("Cycle camera mode not implemented yet");
  }

  setupControls(): void {
    // Configura o ponto de órbita (target)
    if (this.target && this.target.getPosition) {
      this.orbitControls.target.copy(this.target.getPosition());
    }

    // Definir limites de distância (zoom)
    this.orbitControls.minDistance = 1;
    this.orbitControls.maxDistance = 15;

    // Definir limites de rotação vertical
    this.orbitControls.minPolarAngle = 0.1;
    this.orbitControls.maxPolarAngle = Math.PI / 2 - 0;

    // Suavização (inércia)
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.05;

    // Velocidade de rotação
    this.orbitControls.rotateSpeed = 0.6;

    // Velocidade de zoom
    this.orbitControls.zoomSpeed = 0.8;

    // Desabilitar movimento lateral
    this.orbitControls.enablePan = false;
  }

  update(deltaTime: number): void {
    const timeStep = Math.min(deltaTime, 1 / 30);
    if (!this.target) return;

    const currentPosition = this.target.getPosition();

    // Usar apenas um método de seguimento
    // if (!this.inputManager.isMouseDown()) {
    //    this.applyCameraPosition(timeStep);
    // } else {
      const playerMovement = new THREE.Vector3().subVectors(currentPosition, this.lastTargetPosition);

      if (playerMovement.length() > 0) {
        this.camera.position.add(playerMovement);
      }
    // }

    this.orbitControls.target.copy(currentPosition);
    this.lastTargetPosition.copy(currentPosition);
    this.orbitControls.update();
  }

  applyCameraPosition(timeStep: number = 1 / 30): void {
    if (!this.target) return;

    // Obter posição do target
    const targetPosition = this.target.getPosition();

    // Nota: Mantive o typo 'getMovimentDirection' para compatibilidade com seu código original
    const cannonDirection = this.target.getMovimentDirection();
    const movementDirection = new THREE.Vector3(cannonDirection.x, cannonDirection.y, cannonDirection.z).normalize();

    // Configurações da posição da câmera
    const distanceBase = 2; // Distância da câmera ao veículo
    const heightBase = 0.8; // Altura da câmera

    const directionVector = movementDirection.clone();
    if (this.target.getCurrentSpeed() < -0.5) {
      directionVector.negate();
    }

    // Escalar pelo distanceBase
    directionVector.multiplyScalar(distanceBase);

    // Adicionar componente de altura
    directionVector.y = heightBase;

    // Calcular a nova posição da câmera
    const newCameraPosition = targetPosition.clone().add(directionVector);

    // Calcular fator de interpolação baseado em timeStep
    // const lerpFactor = Math.min(2.5 * timeStep, 1.0); // (Não utilizado no código original, mas mantido a lógica)

    // Aplicar suavização para evitar movimentos bruscos (lerp)
    this.camera.position.lerp(newCameraPosition, 1); 
  }

  // Método para obter a posição atual da câmera
  getPosition(): THREE.Vector3 {
    return this.camera.position;
  }

  // Método para habilitar/desabilitar os controles
  enable(enabled: boolean = true): void {
    this.orbitControls.enabled = enabled;
  }
}