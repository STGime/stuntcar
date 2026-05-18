import * as THREE from 'three';

/**
 * A small low-poly house with a tall blinking sign on its roof.
 *
 * Used as a one-off Easter-egg-style decoration in the inside of Track 1's
 * circuit — the sign reads "CringeDad72 is the best!" (a shout-out).
 *
 * The sign always Y-billboards toward the camera so it's readable from
 * anywhere on the lap, and toggles between bright and dim opacity every
 * `BLINK_PERIOD_SEC * 2` so the text reads as a neon flash.
 */

const BLINK_PERIOD_SEC = 0.55;

export class House {
  private readonly group: THREE.Group;
  private readonly sign: THREE.Mesh;
  private readonly signMat: THREE.MeshBasicMaterial;
  private readonly tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene, position: THREE.Vector3, signText: string) {
    this.group = new THREE.Group();
    this.group.position.copy(position);
    scene.add(this.group);

    // --- House body --------------------------------------------------------
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xd9c7a3,
      roughness: 0.85,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 3.4), wallMat);
    body.position.y = 1.5;
    body.castShadow = true;
    body.receiveShadow = true;
    this.group.add(body);

    // --- Roof (4-sided pyramid) -------------------------------------------
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x7b3a2a,
      roughness: 0.75,
    });
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(2.9, 1.7, 4),
      roofMat,
    );
    roof.position.y = 3 + 0.85;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    this.group.add(roof);

    // --- Door + window + chimney -----------------------------------------
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 1.5, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x4a2818, roughness: 0.85 }),
    );
    door.position.set(0, 0.75, 1.72);
    this.group.add(door);

    const winMat = new THREE.MeshStandardMaterial({
      color: 0x4fd1c5,
      emissive: 0xffe1b0,
      emissiveIntensity: 0.6,
      roughness: 0.4,
    });
    const winL = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.7, 0.05), winMat);
    winL.position.set(-1.25, 1.85, 1.72);
    this.group.add(winL);
    const winR = winL.clone();
    winR.position.x = 1.25;
    this.group.add(winR);

    const chimney = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.9, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x5c4a3a, roughness: 0.9 }),
    );
    chimney.position.set(1.2, 3 + 0.6, -0.6);
    chimney.castShadow = true;
    this.group.add(chimney);

    // --- Sign post + panel ------------------------------------------------
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x2a2f38,
      metalness: 0.65,
      roughness: 0.4,
    });
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 6, 8),
      postMat,
    );
    post.position.set(0, 3 + 3, 0);
    post.castShadow = true;
    this.group.add(post);

    const tex = makeSignTexture(signText);
    this.signMat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.sign = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.3), this.signMat);
    this.sign.position.set(0, 9.5, 0);
    this.group.add(this.sign);
  }

  /** Per render frame: Y-billboard toward the camera + blink. */
  update(elapsedSec: number, cameraPos: THREE.Vector3): void {
    this.sign.getWorldPosition(this.tmp);
    // Look only in the XZ plane so the sign stays vertical.
    this.sign.lookAt(cameraPos.x, this.tmp.y, cameraPos.z);

    // Blink: alternate between bright + dim every BLINK_PERIOD_SEC.
    const phase = Math.floor(elapsedSec / BLINK_PERIOD_SEC);
    this.signMat.opacity = phase % 2 === 0 ? 0.95 : 0.18;
  }
}

function makeSignTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // Dark background card.
  ctx.fillStyle = '#0c1018';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Neon border + corner accents.
  ctx.strokeStyle = '#ff4f9a';
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

  // Text.
  ctx.fillStyle = '#ffd166';
  ctx.font = 'bold 64px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Pink glow underlay (drawn first so the yellow sits on top).
  ctx.shadowColor = '#ff4f9a';
  ctx.shadowBlur = 12;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
