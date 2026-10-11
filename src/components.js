import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as CANNON from 'cannon-es';
import { CAMERA, POUR_LIMIT, STEPS } from './config.js';
import {
  animate, clamp, cutPuzzle, easeInOut, lerp, neighborsOf, nextFrame, range, reducedMotion, rng, wrapAngle,
} from './utils.js';

const SNAP_ANGLE = (10 * Math.PI) / 180;
const QUARTER = Math.PI / 2;
const NEAR = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
const UP = new THREE.Vector3(0, 1, 0);
const AHEAD = new THREE.Vector3(0, 0, 1);
const ONE = new THREE.Vector3(1, 1, 1);
const THICK = 0.09;
const LIFT = 0.2;
const HOVER = 0.45;

const pieceGeometry = (pc, P, uv) => {
  const n = pc.pts.length;
  const half = P.t / 2;
  const position = new Float32Array(n * 12);
  const normal = new Float32Array(n * 12);
  const uvs = new Float32Array(n * 8);
  const area = pc.pts.reduce((sum, [x, y], k) => sum + x * pc.pts[(k + 1) % n][1] - pc.pts[(k + 1) % n][0] * y, 0);
  const out = Math.sign(area) || 1;
  pc.pts.forEach(([x, y], k) => {
    const [px, py] = pc.pts[(k + n - 1) % n];
    const [nx, ny] = pc.pts[(k + 1) % n];
    const len = Math.hypot(nx - px, ny - py) || 1;
    const side = [((ny - py) / len) * out, 0, (-(nx - px) / len) * out];
    [[half, [0, 1, 0], uv.top(pc, x, y)], [-half, [0, -1, 0], uv.back(pc, x, y)], [half, side, uv.edge(k / n, 0)], [-half, side, uv.edge(k / n, 1)]]
      .forEach(([h, norm, st], ring) => {
        const v = ring * n + k;
        position.set([x, h, y], v * 3);
        normal.set(norm, v * 3);
        uvs.set(st, v * 2);
      });
  });
  const faces = THREE.ShapeUtils.triangulateShape(pc.pts.map(([x, y]) => new THREE.Vector2(x, y)), []);
  const facing = (a, b, c, want) => {
    const at = (v, o) => position[v * 3 + o];
    const cross = [
      (at(b, 1) - at(a, 1)) * (at(c, 2) - at(a, 2)) - (at(b, 2) - at(a, 2)) * (at(c, 1) - at(a, 1)),
      (at(b, 2) - at(a, 2)) * (at(c, 0) - at(a, 0)) - (at(b, 0) - at(a, 0)) * (at(c, 2) - at(a, 2)),
      (at(b, 0) - at(a, 0)) * (at(c, 1) - at(a, 1)) - (at(b, 1) - at(a, 1)) * (at(c, 0) - at(a, 0)),
    ];
    return cross[0] * want[0] + cross[1] * want[1] + cross[2] * want[2] >= 0 ? [a, b, c] : [a, c, b];
  };
  const index = [
    ...faces.flatMap(([a, b, c]) => facing(a, b, c, [0, 1, 0])),
    ...faces.flatMap(([a, b, c]) => facing(a + n, b + n, c + n, [0, -1, 0])),
    ...range(0, n).flatMap((k) => {
      const j = (k + 1) % n;
      const want = [normal[(2 * n + k) * 3], 0, normal[(2 * n + k) * 3 + 2]];
      return [...facing(2 * n + k, 2 * n + j, 3 * n + j, want), ...facing(2 * n + k, 3 * n + j, 3 * n + k, want)];
    }),
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  return geometry;
};

const printSheet = (image, P) => {
  const strip = 96;
  const k = Math.min(1, 4096 / Math.max(P.w, P.h + strip));
  const [w, h] = [Math.round(P.w * k), Math.round(P.h * k)];
  const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h + strip });
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, w, h);
  ctx.fillStyle = '#8e9995';
  ctx.fillRect(0, h, w, strip);
  const r = rng(11);
  range(0, Math.round(w * 3)).forEach(() => {
    ctx.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '20,30,26'},${0.04 + r() * 0.07})`;
    ctx.fillRect(r() * w, h + r() * strip, 1 + r() * 3, 1);
  });
  const H = h + strip;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return {
    texture,
    part: h / H,
    uv: {
      top: (pc, x, y) => [(pc.hx + x) / P.w, 1 - ((pc.hy + y) * k) / H],
      back: (pc, x, y) => [0.05 + ((pc.hx + x) / P.w) * 0.9, 1 - (h + strip * (0.5 + (y / P.ch) * 0.3)) / H],
      edge: (u, v) => [0.05 + u * 0.9, 1 - (h + strip * (0.15 + v * 0.1)) / H],
    },
  };
};

export const createTable = ({
  host, base, float, insets, on, tier,
}) => {
  const renderer = new THREE.WebGLRenderer({ canvas: base, antialias: true, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  const scene = new THREE.Scene();
  const persp = new THREE.PerspectiveCamera(CAMERA.fov, 1, 1, 1e6);
  const ortho = new THREE.OrthographicCamera();
  const board = new THREE.Group();
  const sky = new THREE.HemisphereLight(0xfff3df, 0x40382f, 0.5);
  const lamp = new THREE.SpotLight(0xffe6c8, 1, 0, 1, 0.9, 2);
  const hung = { home: new THREE.Vector3(), aim: new THREE.Vector3(), reach: 1 };
  const shadowView = new THREE.Matrix4();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ roughness: 1 }));
  const room = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  lamp.castShadow = true;
  lamp.shadow.radius = 2.5;
  lamp.shadow.bias = -0.0002;
  lamp.shadow.updateMatrices = function aimAtView() {
    const cam = this.camera;
    cam.position.setFromMatrixPosition(lamp.matrixWorld);
    cam.lookAt(hung.aim);
    const far = cam.position.distanceTo(hung.aim);
    Object.assign(cam, {
      fov: Math.min(150, THREE.MathUtils.radToDeg(2 * Math.atan(hung.reach / far))), aspect: 1, near: far * 0.05, far: far * 6,
    });
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    shadowView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(shadowView, cam.coordinateSystem, cam.reversedDepth);
    this.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(shadowView);
  };
  ground.receiveShadow = true;
  board.add(ground);
  scene.add(board, sky, lamp, lamp.target);
  scene.environmentIntensity = 0.22;

  const pen = float.getContext('2d');
  const caster = new THREE.Raycaster();
  const plane = new THREE.Plane(UP, 0);
  const hitCtx = document.createElement('canvas').getContext('2d');
  const view = {
    s: 1, cx: 0, cy: 0, r: 0, mode: '3d',
  };
  const surface = { top: null, tile: null, line: '242, 235, 221' };
  const turning = { edge: true, scroll: true, zoom: true };
  let post = null;
  let cover = null;
  const floating = new Set();
  const selected = new Set();
  const tinted = new Set();
  const pointers = new Map();
  const stale = new Set();
  const easing = new Set();
  const sims = new Map();
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -42, 0), allowSleep: true });
  const floor = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);
  world.solver.iterations = 12;
  Object.assign(world.defaultContactMaterial, { friction: 0.55, restitution: 0.02 });

  let Q = tier(100);
  let P = null;
  let batch = null;
  let sheet = null;
  let groups = new Map();
  let pieceGroup = null;
  let face = null;
  let z = [];
  let nextId = 1;
  let W = 0;
  let H = 0;
  let token = 0;
  let busy = 0;
  let finish = 0;
  let flipping = null;
  let lasso = null;
  let gesture = null;
  let lastTap = null;
  let hoverId;
  let hoverFrame = 0;
  let raf = 0;
  let dirty = false;
  let lastTick = 0;
  let slow = { sum: 0, count: 0, step: 0 };
  let spinning = 0;
  let simSince = 0;
  let simPatience = 1800;
  let past = [];
  let future = [];
  let pending = null;

  const toHome = (g, wx, wy) => {
    const [c, s] = [Math.cos(g.a), Math.sin(g.a)];
    const [dx, dy] = [wx - g.tx, wy - g.ty];
    return [c * dx + s * dy, -s * dx + c * dy];
  };
  const toWorld = (g, hx, hy) => {
    const [c, s] = [Math.cos(g.a), Math.sin(g.a)];
    return [c * hx - s * hy + g.tx, s * hx + c * hy + g.ty];
  };
  const turned = (wx, wy, r = view.r) => [Math.cos(r) * wx - Math.sin(r) * wy, Math.sin(r) * wx + Math.cos(r) * wy];
  const centerOf = (g) => toWorld(g, g.hx, g.hy);
  const camera = () => (view.mode === 'flat' ? ortho : persp);
  const scratch = new THREE.Vector3();
  const worldOf = (x, y, above = 0) => {
    plane.constant = -(P.t + above);
    caster.setFromCamera(new THREE.Vector2((x / W) * 2 - 1, 1 - (y / H) * 2), camera());
    const hit = caster.ray.intersectPlane(plane, scratch);
    if (!hit) return [view.cx, view.cy];
    board.worldToLocal(hit);
    return [hit.x, hit.z];
  };
  const screenOf = (wx, wy) => {
    const v = board.localToWorld(new THREE.Vector3(wx, P.t, wy)).project(camera());
    return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H];
  };
  const boundsOf = (ids) => {
    const pts = ids.flatMap((id) => {
      const g = groups.get(id);
      return g.members.map((i) => turned(...toWorld(g, P.pieces[i].hx, P.pieces[i].hy)));
    });
    const pad = Math.max(P.slotW, P.slotH) / 2;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const [x0, y0] = [Math.min(...xs) - pad, Math.min(...ys) - pad];
    const [x1, y1] = [Math.max(...xs) + pad, Math.max(...ys) + pad];
    return {
      x0, y0, x1, y1, w: x1 - x0, h: y1 - y0,
    };
  };

  const place = () => {
    if (!P || !W) return;
    board.rotation.y = -view.r;
    board.updateMatrixWorld(true);
    const target = board.localToWorld(new THREE.Vector3(view.cx, 0, view.cy));
    const reach = (Math.hypot(W, H) / view.s) * (view.mode === 'flat' ? 0.56 : 0.8);
    if (view.mode === 'flat') {
      Object.assign(ortho, {
        left: -W / 2, right: W / 2, top: H / 2, bottom: -H / 2, zoom: view.s, near: P.unit, far: P.unit * 2000,
      });
      ortho.position.set(target.x, P.unit * 1000, target.z);
      ortho.up.set(0, 0, -1);
      ortho.lookAt(target);
      ortho.updateProjectionMatrix();
    } else {
      const d = H / (2 * view.s * Math.tan((CAMERA.fov * Math.PI) / 360));
      Object.assign(persp, { aspect: W / H, near: d * 0.05, far: d * 20 });
      persp.position.set(target.x, d * Math.cos(CAMERA.tilt), target.z + d * Math.sin(CAMERA.tilt));
      persp.lookAt(target);
      persp.updateProjectionMatrix();
    }
    camera().updateMatrixWorld(true);
    if (post) {
      post.passes.forEach((pass) => { if (pass.camera) pass.camera = camera(); });
      post.blur.enabled = view.mode !== 'flat';
      const d = persp.position.distanceTo(target);
      Object.assign(post.blur.uniforms.focus, { value: d });
      Object.assign(post.blur.uniforms.aperture, { value: 0.008 / d });
      Object.assign(post.blur.uniforms.nearClip, { value: persp.near });
      Object.assign(post.blur.uniforms.farClip, { value: persp.far });
      post.shade.updateGtaoMaterial({
        radius: P.unit * 0.55, distanceExponent: 1.4, thickness: 1.2, scale: 1.15, samples: 12, screenSpaceRadius: false,
      });
    }
    const spot = board.localToWorld(hung.home.clone());
    const high = Math.max(P.unit * Math.sqrt(P.n) * 1.5, P.unit * 16);
    lamp.target.position.copy(spot);
    lamp.position.set(spot.x - high * 0.35, high, spot.z - high * 0.3);
    lamp.angle = Math.atan((P.unit * Math.sqrt(P.n) * 2.4 + P.unit * 14) / high);
    lamp.intensity = 3.3 * lamp.position.distanceToSquared(spot);
    lamp.updateMatrixWorld();
    lamp.target.updateMatrixWorld();
    hung.aim.copy(target);
    hung.reach = reach;
    lamp.shadow.normalBias = (reach / lamp.shadow.mapSize.x) * 1.6;
  };
  const draw = () => {
    dirty = true;
    raf = raf || requestAnimationFrame(tick);
  };

  const dress = () => {
    const { top, tile } = surface;
    if (!top) return;
    renderer.setClearColor(top.color);
    const mat = ground.material;
    [mat.map, mat.normalMap, mat.roughnessMap].forEach((texture) => texture?.dispose());
    Object.assign(mat, {
      map: null, normalMap: null, roughnessMap: null, roughness: top.rough, color: new THREE.Color(top.color),
    });
    if (tile && P) {
      const size = P.unit * 1600;
      const laid = (canvas, colorSpace) => {
        const texture = new THREE.CanvasTexture(canvas);
        Object.assign(texture, {
          colorSpace, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, anisotropy: renderer.capabilities.getMaxAnisotropy(),
        });
        texture.repeat.setScalar(size / (top.span * P.unit));
        return texture;
      };
      ground.scale.set(size, 1, size);
      Object.assign(mat, {
        map: laid(tile.map, THREE.SRGBColorSpace),
        normalMap: laid(tile.normal, THREE.NoColorSpace),
        roughnessMap: tile.rough ? laid(tile.rough, THREE.NoColorSpace) : null,
        color: new THREE.Color(top.gain, top.gain, top.gain),
      });
      mat.normalScale.setScalar(tile.rough ? top.bump : top.bump * 0.5);
    }
    mat.needsUpdate = true;
    draw();
  };

  const pose = { q: new THREE.Quaternion(), qi: new THREE.Quaternion(), at: new THREE.Vector3(), off: new THREE.Vector3(), m: new THREE.Matrix4(), turn: new THREE.Quaternion() };
  const sync = (g) => {
    const [cx, cy] = centerOf(g);
    if (g.sim) {
      pose.q.copy(g.sim.q);
      pose.at.copy(g.sim.at);
    } else {
      pose.q.setFromAxisAngle(UP, -g.a);
      if (g.tilt) pose.q.premultiply(g.tilt);
      pose.at.set(cx, g.y + g.lift * P.unit * LIFT, cy);
    }
    g.members.forEach((i) => {
      const pc = P.pieces[i];
      const down = face[i] ? 0 : Math.PI;
      const mid = flipping?.i === i;
      const angle = mid ? lerp(Math.PI - down, down, easeInOut(flipping.t)) : down;
      pose.off.set(pc.hx - g.hx, mid ? Math.sin(Math.PI * flipping.t) * P.unit * 0.5 : 0, pc.hy - g.hy).applyQuaternion(pose.q).add(pose.at);
      pose.qi.copy(pose.q);
      if (angle) pose.qi.multiply(pose.turn.setFromAxisAngle(AHEAD, angle));
      batch.setMatrixAt(i, pose.m.compose(pose.off, pose.qi, ONE));
    });
    if (cover && groups.size === 1) {
      cover.quaternion.copy(pose.q);
      cover.position.set(P.w / 2 - g.hx, P.t / 2 + P.unit * 0.004, P.h / 2 - g.hy).applyQuaternion(pose.q).add(pose.at);
    }
  };
  const render = (layer = 'both') => {
    (layer === 'float' ? [...floating, ...(flipping ? [flipping.gid] : [])] : z).forEach((id) => stale.add(id));
    draw();
  };

  const stack = (ids) => {
    const cell = P.unit * 1.05;
    const span = P.unit * 0.36;
    const moved = new Set(ids);
    const heap = new Map();
    const keyOf = (x, y) => `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
    const around = NEAR.concat([[1, 1], [-1, -1], [1, -1], [-1, 1]]);
    const topAt = (x, y) => around.reduce((top, [dx, dy]) => (heap.get(keyOf(x + dx * cell, y + dy * cell)) ?? [])
      .reduce((best, p) => (Math.hypot(p[0] - x, p[1] - y) < P.unit * 0.5 ? Math.max(best, p[2]) : best), top), 0);
    const note = (x, y, top) => heap.set(keyOf(x, y), [...(heap.get(keyOf(x, y)) ?? []), [x, y, top]]);
    z.forEach((id) => {
      const g = groups.get(id);
      const pts = g.members.map((i) => toWorld(g, P.pieces[i].hx, P.pieces[i].hy));
      const [c, s] = [Math.cos(g.a), Math.sin(g.a)];
      const sides = g.members.length === 1 ? [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([u, v]) => [pts[0][0] + (c * u - s * v) * span, pts[0][1] + (s * u + c * v) * span]) : [];
      if (moved.has(id) && sides.length) {
        const [east, west, south, north] = sides.map(([x, y]) => topAt(x, y));
        const [sx, sy] = [(east - west) / (2 * span), (south - north) / (2 * span)];
        const base = Math.max(topAt(...pts[0]) - Math.hypot(sx, sy) * span * 0.5, (east + west) / 2, (south + north) / 2);
        const slope = new THREE.Vector3(-(c * sx - s * sy), 1, -(s * sx + c * sy)).normalize();
        Object.assign(g, { y: base + P.t / 2, tilt: sx || sy ? new THREE.Quaternion().setFromUnitVectors(UP, slope) : null });
      } else if (moved.has(id)) {
        Object.assign(g, { y: pts.reduce((top, [x, y]) => Math.max(top, topAt(x, y)), 0) + P.t / 2, tilt: null });
      }
      const lean = g.tilt ? new THREE.Vector3(0, 1, 0).applyQuaternion(g.tilt) : UP;
      const [cx, cy] = centerOf(g);
      [...pts, ...sides].forEach(([x, y]) => note(x, y, g.y + P.t / 2 - ((x - cx) * lean.x + (y - cy) * lean.z) / lean.y));
    });
  };

  const bodyOf = (g, mass) => {
    const k = 1 / P.unit;
    const body = new CANNON.Body({
      mass, sleepSpeedLimit: 0.35, sleepTimeLimit: 0.2, linearDamping: 0.3, angularDamping: 0.5,
    });
    const half = new CANNON.Vec3(P.cw * k * 0.46, (P.t * k) / 2, P.ch * k * 0.46);
    if (g.members.length <= 24) {
      g.members.forEach((i) => body.addShape(new CANNON.Box(half), new CANNON.Vec3((P.pieces[i].hx - g.hx) * k, 0, (P.pieces[i].hy - g.hy) * k)));
    } else {
      const xs = g.members.map((i) => P.pieces[i].hx - g.hx);
      const ys = g.members.map((i) => P.pieces[i].hy - g.hy);
      body.addShape(
        new CANNON.Box(new CANNON.Vec3(((Math.max(...xs) - Math.min(...xs) + P.cw) * k) / 2, (P.t * k) / 2, ((Math.max(...ys) - Math.min(...ys) + P.ch) * k) / 2)),
        new CANNON.Vec3(((Math.max(...xs) + Math.min(...xs)) * k) / 2, 0, ((Math.max(...ys) + Math.min(...ys)) * k) / 2),
      );
    }
    const [cx, cy] = centerOf(g);
    const q = new THREE.Quaternion().setFromAxisAngle(UP, -g.a);
    if (g.tilt) q.premultiply(g.tilt);
    body.position.set(cx * k, (g.y + g.lift * P.unit * LIFT) * k, cy * k);
    body.quaternion.set(q.x, q.y, q.z, q.w);
    return body;
  };
  const land = (id) => {
    const sim = sims.get(id);
    const g = groups.get(id);
    sims.delete(id);
    world.removeBody(sim.body);
    if (!g) return;
    g.sim = null;
    easing.delete(id);
    if (!sim.mass) return;
    const q = new THREE.Quaternion(sim.body.quaternion.x, sim.body.quaternion.y, sim.body.quaternion.z, sim.body.quaternion.w);
    const ahead = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const a = Math.atan2(ahead.z, ahead.x);
    const tilt = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(UP, -a).invert());
    const [ox, oy] = [Math.cos(a) * g.hx - Math.sin(a) * g.hy, Math.sin(a) * g.hx + Math.cos(a) * g.hy];
    Object.assign(g, {
      a, tx: sim.body.position.x * P.unit - ox, ty: sim.body.position.z * P.unit - oy, y: Math.max(P.t / 2, sim.body.position.y * P.unit), lift: 0, tilt: Math.abs(tilt.w) > 0.9999 ? null : tilt,
    });
    stale.add(id);
  };
  const stopSims = () => {
    const had = sims.size > 0;
    [...sims.keys()].forEach(land);
    return had;
  };
  const simulate = (ids, vx = 0, vy = 0, patience = 1800) => {
    if (Q.physics === 'none' || reducedMotion() || !ids.length) return false;
    const reachOf = P.unit * 2.4;
    const centers = ids.flatMap((id) => {
      const g = groups.get(id);
      return g.members.length > 40 ? [centerOf(g)] : g.members.map((i) => toWorld(g, P.pieces[i].hx, P.pieces[i].hy));
    });
    const near = z.filter((id) => !ids.includes(id) && !sims.has(id)).filter((id) => {
      const [x, y] = centerOf(groups.get(id));
      return centers.some(([cx, cy]) => Math.hypot(cx - x, cy - y) < reachOf);
    }).slice(-90);
    const speed = Math.min(1, 7 / ((Math.hypot(vx, vy) * 1000) / P.unit || 1));
    [...ids.map((id) => [id, true]), ...near.map((id) => [id, false])].forEach(([id, dropped]) => {
      const g = groups.get(id);
      if (sims.has(id)) land(id);
      const mass = dropped || (Q.physics === 'full' && g.members.length <= 24) ? g.members.length : 0;
      const body = bodyOf(g, mass);
      if (dropped) body.velocity.set((vx * 1000 * speed) / P.unit, 0, (vy * 1000 * speed) / P.unit);
      else if (mass) body.sleep();
      world.addBody(body);
      sims.set(id, { body, mass, dropped });
      g.sim = { q: new THREE.Quaternion(), at: new THREE.Vector3() };
    });
    simSince = performance.now();
    simPatience = patience;
    draw();
    return true;
  };
  const stepSims = (dt) => {
    if (!sims.size) return;
    world.step(1 / 120, dt, 4);
    sims.forEach(({ body }, id) => {
      const g = groups.get(id);
      if (!g?.sim) return;
      g.sim.q.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
      g.sim.at.set(body.position.x * P.unit, body.position.y * P.unit, body.position.z * P.unit);
      stale.add(id);
    });
    const awake = [...sims.values()].some((sim) => sim.mass && sim.body.sleepState !== CANNON.Body.SLEEPING);
    if (!awake || performance.now() - simSince > simPatience) {
      stopSims();
      on.change('move');
    }
  };
  const heightOf = (id) => groups.get(id).lift * P.unit * LIFT;
  const follow = () => {
    if (!gesture?.last || gesture.pivot || (gesture.type !== 'drag' && gesture.type !== 'twist')) return;
    const [wx, wy] = worldOf(gesture.last.x, gesture.last.y, heightOf(gesture.id));
    translate(gesture.ids, wx - gesture.wx, wy - gesture.wy);
    Object.assign(gesture, { wx, wy });
  };
  const stepLifts = (dt) => {
    easing.forEach((id) => {
      const g = groups.get(id);
      const want = floating.has(id) ? 1 : (selected.has(id) ? HOVER : 0);
      if (!g || g.sim) {
        easing.delete(id);
        return;
      }
      g.lift += (want - g.lift) * Math.min(1, dt * 16);
      if (Math.abs(want - g.lift) < 0.005) {
        g.lift = want;
        easing.delete(id);
      }
      stale.add(id);
    });
    if (easing.size && gesture) follow();
  };

  const ease = () => {
    const next = STEPS[slow.step];
    if (!next) return;
    slow = { sum: 0, count: 0, step: slow.step + 1 };
    Q = { ...Q, ...next };
    quality();
  };
  function quality() {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.dpr));
    renderer.setSize(W, H, false);
    if (lamp.shadow.mapSize.x !== Q.shadow) {
      lamp.shadow.mapSize.setScalar(Q.shadow);
      lamp.shadow.map?.dispose();
      lamp.shadow.map = null;
    }
    scene.environment = Q.env ? room : null;
    if (Q.post && !post && W) {
      const target = new THREE.WebGLRenderTarget(W, H, { samples: 4, type: THREE.HalfFloatType });
      post = new EffectComposer(renderer, target);
      post.shade = new GTAOPass(scene, persp, W, H);
      post.blur = new BokehPass(scene, persp, { focus: 1, aperture: 0.00001, maxblur: 0.0018 });
      [new RenderPass(scene, persp), post.shade, post.blur, new OutputPass()].forEach((pass) => post.addPass(pass));
    }
    if (!Q.post && post) {
      post.dispose();
      post = null;
    }
    post?.setPixelRatio(renderer.getPixelRatio());
    post?.setSize(W, H);
    place();
    draw();
  }
  function tick(now) {
    raf = 0;
    if (!P || !batch) return;
    const gap = now - lastTick;
    const dt = Math.min(0.05, gap / 1000 || 0.016);
    lastTick = now;
    stepSims(dt);
    stepLifts(dt);
    if (stale.size) {
      stale.forEach((id) => groups.has(id) && sync(groups.get(id)));
      stale.clear();
    }
    if (dirty) {
      dirty = false;
      if (post) post.render();
      else renderer.render(scene, camera());
      if (selected.size) showLasso();
      if (gap < 120) slow = { ...slow, sum: slow.sum + gap, count: slow.count + 1 };
      if (slow.count >= 50) {
        if (slow.sum / slow.count > 30) ease();
        else slow = { ...slow, sum: 0, count: 0 };
      }
    }
    if (sims.size || easing.size) draw();
  }

  const scaleLimits = () => [0.012, clamp((Math.min(W, H) * 0.5) / P.unit, 1.25, 2.5)];
  const full = () => 64 / P.unit;
  const viewChanged = () => {
    place();
    draw();
    on.zoom(Math.round((view.s / full()) * 100));
    on.change('view');
  };
  const holding = (x, y, change) => {
    const [ax, ay] = worldOf(x, y);
    change();
    place();
    const [bx, by] = worldOf(x, y);
    view.cx += ax - bx;
    view.cy += ay - by;
    place();
  };
  const zoomAt = (x, y, f) => holding(x, y, () => { view.s = clamp(view.s * f, ...scaleLimits()); });
  const spinAt = (x, y, da) => holding(x, y, () => { view.r = wrapAngle(view.r + da); });
  const panBy = (from, to) => {
    const [ax, ay] = worldOf(from.x, from.y);
    const [bx, by] = worldOf(to.x, to.y);
    view.cx += ax - bx;
    view.cy += ay - by;
  };
  const spin = async (da) => {
    if (!P) return;
    spinning += 1;
    const mine = spinning;
    let done = 0;
    await animate(380, (e) => {
      if (mine !== spinning || !P) return;
      spinAt(W / 2, H / 2, da * (e - done));
      done = e;
      viewChanged();
    }, easeInOut);
  };
  const coast = (speed) => {
    if (Math.abs(speed) < 0.0008 || reducedMotion()) return;
    spinning += 1;
    const mine = spinning;
    const turn = { speed: clamp(speed, -0.008, 0.008), last: performance.now() };
    const step = (now) => {
      if (mine !== spinning || !P) return;
      const dt = Math.min(40, now - turn.last);
      spinAt(W / 2, H / 2, turn.speed * dt);
      Object.assign(turn, { speed: turn.speed * Math.exp(-dt / 240), last: now });
      viewChanged();
      if (Math.abs(turn.speed) > 0.00012) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const frame = () => {
    const pad = insets();
    return {
      x: pad.left, y: pad.top, w: W - pad.left - pad.right, h: H - pad.top - pad.bottom,
    };
  };
  const fit = async (animated = true) => {
    if (!P) return;
    const b = boundsOf(z);
    const f = frame();
    const depth = view.mode === 'flat' ? 1 : Math.cos(CAMERA.tilt);
    const s = clamp(Math.min(f.w / b.w, f.h / (b.h * depth)) * 0.92, ...scaleLimits());
    const [cx, cy] = turned(
      b.x0 + b.w / 2 - (f.x + f.w / 2 - W / 2) / s,
      b.y0 + b.h / 2 - (f.y + f.h / 2 - H / 2) / (s * depth),
      -view.r,
    );
    const from = { ...view };
    if (!animated) {
      Object.assign(view, { s, cx, cy });
      viewChanged();
      return;
    }
    await animate(420, (e) => {
      Object.assign(view, { s: from.s * (s / from.s) ** e, cx: lerp(from.cx, cx, e), cy: lerp(from.cy, cy, e) });
      viewChanged();
    }, easeInOut);
  };
  const resize = () => {
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const ratio = W ? Math.min(r.width / W, r.height / H) : 1;
    W = r.width;
    H = r.height;
    Object.assign(float, { width: W, height: H });
    if (P) view.s = clamp(view.s * ratio, ...scaleLimits());
    quality();
    if (P) viewChanged();
  };
  new ResizeObserver(resize).observe(host);

  const center = (g) => {
    const [sx, sy] = g.members.reduce(([x, y], i) => [x + P.pieces[i].hx, y + P.pieces[i].hy], [0, 0]);
    return Object.assign(g, { hx: sx / g.members.length, hy: sy / g.members.length });
  };
  const addGroup = (members, a, tx, ty) => {
    const g = center({
      id: nextId, members, a, tx, ty, y: P.t / 2, tilt: null, lift: 0, sim: null,
    });
    nextId += 1;
    groups.set(g.id, g);
    z.push(g.id);
    members.forEach((i) => { pieceGroup[i] = g.id; });
    return g;
  };
  const placeAt = (i, px, py, a) => {
    const pc = P.pieces[i];
    const [c, s] = [Math.cos(a), Math.sin(a)];
    return { a, tx: px - (c * pc.hx - s * pc.hy), ty: py - (s * pc.hx + c * pc.hy) };
  };
  const raise = (ids) => {
    const set = new Set(ids);
    z = [...z.filter((id) => !set.has(id)), ...z.filter((id) => set.has(id))];
  };
  const translate = (ids, dx, dy) => ids.forEach((id) => {
    const g = groups.get(id);
    g.tx += dx;
    g.ty += dy;
  });
  const rotate = (ids, da, px, py) => {
    const [c, s] = [Math.cos(da), Math.sin(da)];
    ids.forEach((id) => {
      const g = groups.get(id);
      const [dx, dy] = [g.tx - px, g.ty - py];
      Object.assign(g, { tx: px + c * dx - s * dy, ty: py + s * dx + c * dy, a: wrapAngle(g.a + da) });
    });
  };
  const merge = (from, into) => {
    if (sims.has(from.id)) land(from.id);
    if (sims.has(into.id)) land(into.id);
    from.members.forEach((i) => { pieceGroup[i] = into.id; });
    into.members.push(...from.members);
    center(Object.assign(into, { tilt: null, y: Math.min(into.y, from.y), lift: 0 }));
    groups.delete(from.id);
    [selected, floating, easing, stale].forEach((set) => set.delete(from.id));
    z = z.filter((id) => id !== from.id);
    stale.add(into.id);
  };

  const scatter = (seed) => {
    const r = rng(seed ^ 0x5bd1e995);
    const radius = P.unit * Math.sqrt(P.n) * 0.5;
    groups = new Map();
    z = [];
    pieceGroup = new Int32Array(P.n);
    face = new Uint8Array(P.n);
    range(0, P.n).map((i) => [r(), i]).sort((a, b) => a[0] - b[0]).forEach(([, i]) => {
      const d = radius * Math.sqrt(r());
      const t = r() * Math.PI * 2;
      const spot = placeAt(i, Math.cos(t) * d, Math.sin(t) * d, r() * Math.PI * 2 - Math.PI);
      face[i] = r() < 0.42 ? 0 : 1;
      addGroup([i], spot.a, spot.tx, spot.ty);
    });
  };

  const restore = (saved) => {
    const members = saved?.v === 1 && Array.isArray(saved.g) ? saved.g.flatMap((row) => row.slice(3)) : [];
    const valid = members.length === P.n && new Set(members).size === P.n
      && members.every((i) => Number.isInteger(i) && i >= 0 && i < P.n) && saved.f?.length === P.n;
    if (!valid) return false;
    groups = new Map();
    z = [];
    pieceGroup = new Int32Array(P.n);
    face = Uint8Array.from(saved.f, (ch) => (ch === '1' ? 1 : 0));
    saved.g.forEach(([tx, ty, a, ...ids]) => {
      addGroup(ids, a, tx, ty);
      if (ids.length > 1) ids.forEach((i) => { face[i] = 1; });
    });
    return true;
  };

  const snapshot = () => {
    const at = new Float64Array(P.n * 3);
    const root = new Int32Array(P.n);
    groups.forEach((g) => {
      const first = Math.min(...g.members);
      g.members.forEach((i) => {
        at.set([g.tx, g.ty, g.a], i * 3);
        root[i] = first;
      });
    });
    return {
      at, root, face: face.slice(), order: z.map((id) => Math.min(...groups.get(id).members)),
    };
  };
  const same = (a, b) => a.root.every((v, i) => v === b.root[i]) && a.face.every((v, i) => v === b.face[i]) && a.at.every((v, i) => v === b.at[i]);
  const told = () => on.history({ undo: past.length, redo: future.length });
  const begin = () => { pending ??= snapshot(); };
  const commit = () => {
    const before = pending;
    pending = null;
    if (!before || same(before, snapshot())) return;
    past = [...past, before].slice(P.n > 2000 ? -40 : -200);
    future = [];
    told();
  };
  const changed = (why) => {
    commit();
    on.change(why);
  };
  const tint = () => {
    const want = new Set([...selected].flatMap((id) => groups.get(id)?.members ?? []));
    const lit = new THREE.Color(1.45, 1.4, 1.2);
    const plain = new THREE.Color(1, 1, 1);
    [...tinted].filter((i) => !want.has(i)).forEach((i) => batch.setColorAt(i, plain));
    [...want].filter((i) => !tinted.has(i)).forEach((i) => batch.setColorAt(i, lit));
    tinted.clear();
    want.forEach((i) => tinted.add(i));
    z.forEach((id) => easing.add(id));
    showLasso();
    draw();
  };
  const revert = (snap) => {
    const members = new Map();
    snap.root.forEach((first, i) => members.set(first, [...(members.get(first) ?? []), i]));
    stopSims();
    groups = new Map();
    z = [];
    face = snap.face.slice();
    [selected, floating, easing, stale].forEach((set) => set.clear());
    hoverId = undefined;
    lastTap = null;
    snap.order.forEach((first) => addGroup(members.get(first), snap.at[first * 3 + 2], snap.at[first * 3], snap.at[first * 3 + 1]));
    stack(z);
    tint();
  };
  const travel = (from, to) => {
    if (!P || busy || gesture || finish || !from.length) return [from, to];
    stopSims();
    const now = snapshot();
    revert(from.at(-1));
    render();
    on.change('history');
    return [from.slice(0, -1), [...to, now]];
  };
  const undo = () => {
    [past, future] = travel(past, future);
    told();
  };
  const redo = () => {
    [future, past] = travel(future, past);
    told();
  };

  const tolerance = () => clamp(14 / view.s, P.unit * 0.22, P.unit * 0.42);
  const misfit = (g, h, i) => {
    if (Math.abs(wrapAngle(g.a - h.a)) > SNAP_ANGLE) return Infinity;
    const [ax, ay] = toWorld(g, P.pieces[i].hx, P.pieces[i].hy);
    const [bx, by] = toWorld(h, P.pieces[i].hx, P.pieces[i].hy);
    return Math.hypot(ax - bx, ay - by);
  };
  const matchesOf = (g) => {
    if (!g.members.every((i) => face[i])) return [];
    const tol = tolerance();
    return g.members
      .flatMap((i) => neighborsOf(P, i).filter((j) => pieceGroup[j] !== g.id && face[j])
        .map((j) => ({ h: groups.get(pieceGroup[j]), i })))
      .map((m) => ({ ...m, d: misfit(g, m.h, m.i) }))
      .filter((m) => m.d < tol)
      .sort((a, b) => a.d - b.d);
  };
  const tweenTo = (g, to, ms) => {
    const from = { a: g.a, tx: g.tx, ty: g.ty };
    const da = wrapAngle(to.a - from.a);
    g.tilt = null;
    return animate(ms, (e) => {
      Object.assign(g, { a: from.a + da * e, tx: lerp(from.tx, to.tx, e), ty: lerp(from.ty, to.ty, e) });
      stale.add(g.id);
      draw();
    });
  };
  const absorb = async (h) => {
    const tol = tolerance();
    const found = [...new Map(h.members
      .flatMap((i) => neighborsOf(P, i).filter((j) => pieceGroup[j] !== h.id && face[j])
        .map((j) => ({ k: groups.get(pieceGroup[j]), d: misfit(groups.get(pieceGroup[j]), h, j) })))
      .filter((m) => m.d < tol)
      .map((m) => [m.k.id, m])).values()];
    if (!found.length) return;
    found.forEach(({ k }) => sims.has(k.id) && land(k.id));
    const loose = found.filter((m) => m.d > 0.5);
    if (loose.length) await Promise.all(loose.map(({ k }) => tweenTo(k, h, 120)));
    found.forEach(({ k }) => merge(k, h));
    on.snap(h.members.length);
    await absorb(h);
  };
  const snapOne = async (id) => {
    const g = groups.get(id);
    const best = g && matchesOf(g)[0];
    if (!best) return;
    if (sims.has(best.h.id)) land(best.h.id);
    await tweenTo(g, best.h, 130);
    merge(g, best.h);
    raise([best.h.id]);
    on.snap(best.h.members.length);
    await absorb(best.h);
  };

  const drop = async (ids, vx = 0, vy = 0) => {
    busy += 1;
    host.classList.remove('is-dragging');
    ids.forEach((id) => {
      floating.delete(id);
      easing.add(id);
    });
    draw();
    await ids.reduce((prev, id) => prev.then(() => snapOne(id)), Promise.resolve());
    const loose = ids.filter((id) => groups.has(id));
    busy -= 1;
    stack(loose);
    if (simulate(loose, vx, vy)) loose.forEach((id) => easing.delete(id));
    render();
    changed('move');
    if (groups.size === 1 && finish === 0) {
      finish = 1;
      past = [];
      future = [];
      told();
      on.complete();
    }
  };

  const lift = (ids) => {
    begin();
    ids.forEach((id) => {
      if (sims.has(id)) land(id);
      groups.get(id).tilt = null;
      floating.add(id);
      easing.add(id);
    });
    raise(ids);
    render('float');
  };

  const flip = async (id, held = [id]) => {
    const g = groups.get(id);
    if (g.members.length > 1) {
      await drop(held);
      return;
    }
    busy += 1;
    begin();
    const i = g.members[0];
    face[i] = face[i] ? 0 : 1;
    on.flip();
    flipping = { gid: id, i, t: 0 };
    await animate(280, (e, t) => {
      flipping.t = t;
      render('float');
    }, (t) => t);
    flipping = null;
    stale.add(id);
    busy -= 1;
    await drop(held);
  };

  const turn = async (ids, da) => {
    if (gesture?.type === 'drag') {
      rotate(ids, da, ...worldOf(gesture.last.x, gesture.last.y));
      render('float');
      return;
    }
    busy += 1;
    const [px, py] = ids.map((id) => centerOf(groups.get(id)))
      .reduce(([x, y], [cx, cy]) => [x + cx / ids.length, y + cy / ids.length], [0, 0]);
    lift(ids);
    let done = 0;
    await animate(160, (e) => {
      rotate(ids, da * (e - done), px, py);
      done = e;
      render('float');
    });
    busy -= 1;
    await drop(ids);
  };

  const showLasso = () => {
    pen.clearRect(0, 0, W, H);
    pen.setLineDash([]);
    pen.lineWidth = 2;
    pen.strokeStyle = `rgba(${surface.line}, 0.95)`;
    pen.shadowColor = 'rgba(0, 0, 0, 0.35)';
    pen.shadowBlur = 4;
    [...selected].forEach((id) => {
      const g = groups.get(id);
      g?.members.forEach((i) => {
        const [x, y] = screenOf(...toWorld(g, P.pieces[i].hx, P.pieces[i].hy));
        pen.beginPath();
        pen.ellipse(x, y, P.unit * view.s * 0.6, P.unit * view.s * 0.6 * (view.mode === 'flat' ? 1 : Math.cos(CAMERA.tilt)), 0, 0, Math.PI * 2);
        pen.stroke();
      });
    });
    pen.shadowBlur = 0;
    if (!lasso) return;
    const [x, y] = [Math.min(lasso.from.x, lasso.to.x), Math.min(lasso.from.y, lasso.to.y)];
    const [w, h] = [Math.abs(lasso.to.x - lasso.from.x), Math.abs(lasso.to.y - lasso.from.y)];
    pen.fillStyle = `rgba(${surface.line}, 0.1)`;
    pen.fillRect(x, y, w, h);
    pen.setLineDash([6, 5]);
    pen.lineWidth = 1.5;
    pen.strokeStyle = `rgba(${surface.line}, 0.9)`;
    pen.strokeRect(x, y, w, h);
  };
  const startLasso = (pt, pid) => {
    gesture = {
      type: 'lasso', from: { ...pt }, to: { ...pt }, pid,
    };
    lasso = gesture;
    showLasso();
  };

  const rimOf = (g, wx, wy) => {
    if (!turning.edge) return null;
    const [cx, cy] = centerOf(g);
    const reach = g.members.reduce((far, i) => Math.max(far, Math.hypot(P.pieces[i].hx - g.hx, P.pieces[i].hy - g.hy)), 0) + P.unit * 0.62;
    return Math.hypot(wx - cx, wy - cy) > reach - P.unit * 0.11 ? [cx, cy] : null;
  };
  const grab = (id, e, wx, wy) => {
    const ids = selected.has(id) ? [...selected] : [id];
    const pivot = selected.has(id) ? null : rimOf(groups.get(id), wx, wy);
    if (!selected.has(id) && selected.size) {
      selected.clear();
      tint();
    }
    const pt = { x: e.clientX, y: e.clientY };
    gesture = {
      type: 'drag', ids, id, pid: e.pointerId, wx, wy, start: pt, last: pt, moved: false, t: performance.now(), born: performance.now(), vx: 0, vy: 0, pivot, angle: pivot ? Math.atan2(wy - pivot[1], wx - pivot[0]) : 0,
    };
    host.classList.add('is-dragging');
    lift(ids);
    on.pick();
  };

  const pinchState = () => {
    const [a, b] = [...pointers.values()];
    return { mid: [(a.x + b.x) / 2, (a.y + b.y) / 2], dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, angle: Math.atan2(b.y - a.y, b.x - a.x) };
  };
  const startPinch = () => ({
    type: 'pinch', ...pinchState(), slack: 0, free: false,
  });

  const down = (e) => {
    if (!P || !batch || (e.pointerType === 'mouse' && e.button > 2)) return;
    host.setPointerCapture(e.pointerId);
    host.focus({ preventScroll: true });
    on.activity();
    spinning += 1;
    const pt = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, pt);
    if (pointers.size === 2) {
      if (gesture?.type === 'drag' && !gesture.moved && performance.now() - gesture.born < 140) {
        const held = gesture;
        gesture = startPinch();
        drop(held.ids);
        return;
      }
      if (gesture?.type === 'drag') {
        const other = [...pointers.entries()].find(([pid]) => pid !== gesture.pid)[1];
        const prim = pointers.get(gesture.pid);
        gesture = { ...gesture, type: 'twist', angle: Math.atan2(other.y - prim.y, other.x - prim.x) };
      } else if (gesture?.type !== 'lasso') {
        clearTimeout(gesture?.timer);
        host.classList.remove('is-spinning');
        gesture = startPinch();
      }
      return;
    }
    if (pointers.size > 2) return;
    if (e.button === 2 || e.altKey) {
      gesture = {
        type: 'spin', pid: e.pointerId, angle: Math.atan2(pt.y - H / 2, pt.x - W / 2), t: performance.now(), speed: 0,
      };
      host.classList.add('is-spinning');
      return;
    }
    const [wx, wy] = worldOf(pt.x, pt.y);
    const id = busy || e.button === 1 ? undefined : z.findLast((gid) => pieceAt(groups.get(gid), wx, wy) >= 0);
    if (id !== undefined) {
      grab(id, e, wx, wy);
      return;
    }
    if (e.shiftKey) {
      startLasso(pt, e.pointerId);
      return;
    }
    gesture = {
      type: 'pan', start: pt, last: { ...pt }, moved: false, pid: e.pointerId,
    };
    if (e.pointerType !== 'mouse') {
      gesture.timer = setTimeout(() => {
        if (gesture?.type !== 'pan' || gesture.moved) return;
        navigator.vibrate?.(12);
        startLasso(gesture.start, gesture.pid);
      }, 420);
    }
  };

  const dragMove = (pt) => {
    if (!gesture.moved && Math.hypot(pt.x - gesture.start.x, pt.y - gesture.start.y) < 4) return;
    if (gesture.pivot) {
      const [px, py] = worldOf(pt.x, pt.y);
      const angle = Math.atan2(py - gesture.pivot[1], px - gesture.pivot[0]);
      rotate(gesture.ids, wrapAngle(angle - gesture.angle), ...gesture.pivot);
      Object.assign(gesture, { angle, moved: true, last: { ...pt }, t: performance.now() });
      render('float');
      return;
    }
    const [wx, wy] = worldOf(pt.x, pt.y, heightOf(gesture.id));
    const now = performance.now();
    const dt = Math.max(8, now - gesture.t);
    const [dx, dy] = [wx - gesture.wx, wy - gesture.wy];
    translate(gesture.ids, dx, dy);
    Object.assign(gesture, {
      moved: true, wx, wy, t: now, last: { ...pt }, vx: gesture.vx * 0.5 + (dx / dt) * 0.5, vy: gesture.vy * 0.5 + (dy / dt) * 0.5,
    });
    render('float');
  };

  const moves = {
    drag: (e, pt) => { if (e.pointerId === gesture.pid) dragMove(pt); },
    twist: (e) => {
      const prim = pointers.get(gesture.pid);
      const other = [...pointers.entries()].find(([pid]) => pid !== gesture.pid)?.[1];
      if (!prim || !other) return;
      if (e.pointerId === gesture.pid) dragMove(prim);
      const angle = Math.atan2(other.y - prim.y, other.x - prim.x);
      rotate(gesture.ids, wrapAngle(angle - gesture.angle), ...worldOf(prim.x, prim.y));
      Object.assign(gesture, { angle, moved: true });
      render('float');
    },
    pan: (e, pt) => {
      if (!gesture.moved && Math.hypot(pt.x - gesture.start.x, pt.y - gesture.start.y) < 6) return;
      clearTimeout(gesture.timer);
      panBy(gesture.last, pt);
      Object.assign(gesture, { moved: true, last: { ...pt } });
      viewChanged();
    },
    pinch: () => {
      const now = pinchState();
      const da = wrapAngle(now.angle - gesture.angle);
      const slack = gesture.slack + da;
      const free = gesture.free || Math.abs(slack) > 0.14;
      panBy({ x: gesture.mid[0], y: gesture.mid[1] }, { x: now.mid[0], y: now.mid[1] });
      if (turning.zoom) zoomAt(now.mid[0], now.mid[1], now.dist / gesture.dist);
      if (gesture.free) spinAt(now.mid[0], now.mid[1], da);
      Object.assign(gesture, now, { slack, free });
      viewChanged();
    },
    spin: (e, pt) => {
      const angle = Math.atan2(pt.y - H / 2, pt.x - W / 2);
      const da = wrapAngle(angle - gesture.angle);
      const now = performance.now();
      spinAt(W / 2, H / 2, da);
      Object.assign(gesture, { angle, speed: gesture.speed * 0.5 + (da / Math.max(8, now - gesture.t)) * 0.5, t: now });
      viewChanged();
    },
    lasso: (e, pt) => {
      gesture.to = { ...pt };
      showLasso();
    },
  };

  const hover = (e) => {
    const [x, y] = [e.clientX, e.clientY];
    hoverFrame = hoverFrame || requestAnimationFrame(() => {
      hoverFrame = 0;
      if (!P || gesture) return;
      const [wx, wy] = worldOf(x, y);
      hoverId = z.findLast((gid) => pieceAt(groups.get(gid), wx, wy) >= 0);
      host.classList.toggle('is-over-piece', hoverId !== undefined);
      host.classList.toggle('is-over-rim', hoverId !== undefined && !selected.has(hoverId) && Boolean(rimOf(groups.get(hoverId), wx, wy)));
    });
  };

  const move = (e) => {
    const pt = pointers.get(e.pointerId);
    if (!pt) {
      if (e.pointerType === 'mouse') hover(e);
      return;
    }
    on.activity();
    const to = { x: e.clientX, y: e.clientY };
    if (gesture) moves[gesture.type]?.(e, to);
    Object.assign(pt, to);
  };

  const endLasso = (g) => {
    lasso = null;
    showLasso();
    const [x0, y0] = [Math.min(g.from.x, g.to.x), Math.min(g.from.y, g.to.y)];
    const [x1, y1] = [Math.max(g.from.x, g.to.x), Math.max(g.from.y, g.to.y)];
    selected.clear();
    z.forEach((id) => {
      const [cx, cy] = screenOf(...centerOf(groups.get(id)));
      if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) selected.add(id);
    });
    on.select(selected.size);
    tint();
  };

  const release = (g) => {
    if (!g.moved) {
      const now = performance.now();
      const double = lastTap && now - lastTap.t < 340 && lastTap.id === g.id;
      lastTap = double ? null : { t: now, id: g.id };
      if (double) {
        host.classList.remove('is-dragging');
        flip(g.id, g.ids);
        return;
      }
    }
    const fresh = !g.pivot && performance.now() - g.t < 70;
    drop(g.ids, fresh ? g.vx : 0, fresh ? g.vy : 0);
  };

  const up = (e) => {
    if (!pointers.delete(e.pointerId) || !gesture) return;
    const g = gesture;
    if (g.type === 'twist') {
      if (e.pointerId === g.pid) {
        gesture = null;
        release(g);
      } else {
        gesture = { ...g, type: 'drag' };
      }
      return;
    }
    if (g.type === 'pinch') {
      const rest = [...pointers.entries()][0];
      gesture = rest ? {
        type: 'pan', start: { ...rest[1] }, last: { ...rest[1] }, moved: true, pid: rest[0],
      } : null;
      return;
    }
    if (e.pointerId !== g.pid) return;
    gesture = null;
    clearTimeout(g.timer);
    if (g.type === 'drag') release(g);
    if (g.type === 'lasso') endLasso(g);
    if (g.type === 'spin') {
      host.classList.remove('is-spinning');
      if (performance.now() - g.t < 80) coast(g.speed);
    }
    if (g.type === 'pan' && !g.moved && selected.size) {
      selected.clear();
      on.select(0);
      tint();
    }
  };

  const wheel = (e) => {
    if (!P) return;
    e.preventDefault();
    on.activity();
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
    if (gesture?.type === 'drag' && turning.scroll && !gesture.pivot) {
      rotate(gesture.ids, clamp(dy * 0.004, -0.26, 0.26), ...worldOf(e.clientX, e.clientY));
      gesture.moved = true;
      render('float');
      return;
    }
    if (e.altKey) {
      spinning += 1;
      spinAt(W / 2, H / 2, clamp(dy * 0.003, -0.3, 0.3));
      viewChanged();
      return;
    }
    if (turning.zoom) zoomAt(e.clientX, e.clientY, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0016)));
    else panBy({ x: W / 2, y: H / 2 }, { x: W / 2 - e.deltaX, y: H / 2 - dy });
    viewChanged();
  };

  host.addEventListener('pointerdown', down);
  host.addEventListener('pointermove', move);
  host.addEventListener('pointerup', up);
  host.addEventListener('pointercancel', up);
  host.addEventListener('wheel', wheel, { passive: false });
  host.addEventListener('pointerleave', () => host.classList.remove('is-over-piece', 'is-over-rim'));

  function inPiece(i, hx, hy) {
    const pc = P.pieces[i];
    const [lx, ly] = [hx - pc.hx, hy - pc.hy];
    return Math.abs(lx) < P.slotW / 2 && Math.abs(ly) < P.slotH / 2 && hitCtx.isPointInPath(pc.path, face[i] ? lx : -lx, ly);
  }
  function pieceAt(g, wx, wy) {
    const [hx, hy] = toHome(g, wx, wy);
    if (g.members.length === 1) return inPiece(g.members[0], hx, hy) ? g.members[0] : -1;
    const [col, row] = [Math.floor(hx / P.cw), Math.floor(hy / P.ch)];
    const found = NEAR.map(([dc, dr]) => [row + dr, col + dc])
      .filter(([r, c]) => r >= 0 && c >= 0 && r < P.rows && c < P.cols)
      .map(([r, c]) => r * P.cols + c)
      .find((i) => pieceGroup[i] === g.id && inPiece(i, hx, hy));
    return found ?? -1;
  }

  const tweenMany = async (targets, ms) => {
    busy += 1;
    begin();
    stopSims();
    const from = targets.map(({ g }) => ({ a: g.a, tx: g.tx, ty: g.ty }));
    targets.forEach(({ g }) => { g.tilt = null; });
    await animate(ms, (e) => {
      targets.forEach(({ g, to }, n) => Object.assign(g, {
        a: from[n].a + wrapAngle(to.a - from[n].a) * e,
        tx: lerp(from[n].tx, to.tx, e),
        ty: lerp(from[n].ty, to.ty, e),
      }));
      render();
    }, easeInOut);
    busy -= 1;
    stack(z);
    render();
    changed('assist');
  };

  const layOut = (list, x0, y0, cols) => {
    const step = Math.max(P.slotW, P.slotH) * 1.04;
    return list.map((g, n) => {
      const i = g.members[0];
      const spot = turned(x0 + (n % cols) * step + step / 2, y0 + Math.floor(n / cols) * step + step / 2, -view.r);
      return { g, to: placeAt(i, ...spot, g.a) };
    });
  };

  const assists = {
    flip: async () => {
      const down = [...groups.values()].filter((g) => g.members.length === 1 && !face[g.members[0]]);
      if (!down.length) return;
      busy += 1;
      begin();
      stopSims();
      face.fill(1);
      await animate(reducedMotion() ? 0 : 320, (e, t) => {
        down.forEach((g) => {
          flipping = { gid: g.id, i: g.members[0], t };
          sync(g);
        });
        flipping = null;
        draw();
      }, (t) => t);
      flipping = null;
      busy -= 1;
      render();
      changed('assist');
    },
    straighten: () => tweenMany([...groups.values()].map((g) => {
      const a = Math.round((g.a + view.r) / QUARTER) * QUARTER - view.r;
      const [cx, cy] = centerOf(g);
      const [c, s] = [Math.cos(a - g.a), Math.sin(a - g.a)];
      const [dx, dy] = [g.tx - cx, g.ty - cy];
      return { g, to: { a, tx: cx + c * dx - s * dy, ty: cy + s * dx + c * dy } };
    }), 420),
    edges: async () => {
      const loose = z.map((id) => groups.get(id)).filter((g) => g.members.length === 1);
      const edges = loose.filter((g) => P.pieces[g.members[0]].edge);
      const edgeIds = new Set(edges.map((g) => g.id));
      const others = z.filter((id) => !edgeIds.has(id));
      if (!edges.length) return;
      const b = boundsOf(others.length ? others : z);
      const step = Math.max(P.slotW, P.slotH) * 1.04;
      const cols = Math.max(Math.ceil(Math.sqrt(edges.length * 3)), Math.floor(b.w / step));
      await tweenMany(layOut(edges, b.x0, b.y1 + step * 0.6, cols), 560);
      fit();
    },
    spread: async () => {
      const loose = z.map((id) => groups.get(id)).filter((g) => g.members.length === 1);
      const built = z.filter((id) => groups.get(id).members.length > 1);
      if (!loose.length) return;
      const step = Math.max(P.slotW, P.slotH) * 1.04;
      const cols = Math.ceil(Math.sqrt(loose.length * (W / H)));
      const b = built.length ? boundsOf(built) : null;
      const [lx, ly] = loose.map((g) => turned(...centerOf(g))).reduce(([x, y], [cx, cy]) => [x + cx / loose.length, y + cy / loose.length], [0, 0]);
      const x0 = b ? b.x1 + step : lx - (cols * step) / 2;
      const y0 = b ? b.y0 : ly - (Math.ceil(loose.length / cols) * step) / 2;
      await tweenMany(layOut(loose, x0, y0, cols), 560);
      fit();
    },
  };

  const key = (e) => {
    if (!P || !batch) return false;
    const k = e.key.toLowerCase();
    const targets = (() => {
      if (gesture?.type === 'drag') return gesture.ids;
      if (selected.size) return [...selected];
      return hoverId !== undefined && groups.has(hoverId) ? [hoverId] : [];
    })();
    const pans = {
      arrowleft: [80, 0], arrowright: [-80, 0], arrowup: [0, 80], arrowdown: [0, -80],
    };
    if ((k === 'q' || k === 'e') && targets.length && (gesture?.type === 'drag' || !busy)) {
      turn(targets, ((e.shiftKey ? 90 : 15) * Math.PI * (k === 'q' ? -1 : 1)) / 180);
      return true;
    }
    if (k === 'f' && targets.length === 1 && !gesture && !busy) {
      lift(targets);
      flip(targets[0]);
      return true;
    }
    if (pans[k]) {
      panBy({ x: W / 2, y: H / 2 }, { x: W / 2 + pans[k][0], y: H / 2 + pans[k][1] });
      viewChanged();
      return true;
    }
    if ((k === '+' || k === '=' || k === '-') && turning.zoom) {
      zoomAt(W / 2, H / 2, k === '-' ? 0.8 : 1.25);
      viewChanged();
      return true;
    }
    if (k === '0') {
      fit();
      return true;
    }
    if ((k === '[' || k === ']' || k === '{' || k === '}') && !gesture) {
      spin(((e.shiftKey ? 90 : 15) * Math.PI * (k === '[' || k === '{' ? -1 : 1)) / 180);
      return true;
    }
    if (k === 'escape' && selected.size) {
      selected.clear();
      on.select(0);
      tint();
      return true;
    }
    return false;
  };

  const clear = () => {
    stopSims();
    if (batch) {
      board.remove(batch);
      batch.dispose();
      batch.material.dispose();
    }
    sheet?.texture.dispose();
    if (cover) {
      board.remove(cover);
      cover.geometry.dispose();
      cover.material.map.dispose();
      cover.material.dispose();
      cover = null;
    }
    batch = null;
    sheet = null;
  };

  const seal = async (ms) => {
    if (cover || groups.size !== 1) return;
    const map = sheet.texture.clone();
    map.repeat.set(1, sheet.part);
    map.offset.set(0, 1 - sheet.part);
    cover = new THREE.Mesh(
      new THREE.PlaneGeometry(P.w, P.h).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({
        map, roughness: 0.58, transparent: true, opacity: 0,
      }),
    );
    cover.receiveShadow = true;
    board.add(cover);
    render();
    await animate(ms, (e) => {
      if (!cover) return;
      cover.material.opacity = e;
      draw();
    }, easeInOut);
  };

  const pour = () => {
    groups.forEach((g) => { g.y = g.y * 3 + P.unit * 0.4; });
    simulate(z.slice(), 0, 0, 4200);
  };

  const load = async ({
    meta, bitmap, saved, onProgress,
  }) => {
    token += 1;
    const mine = token;
    if (!W) resize();
    clear();
    Q = tier(meta.n);
    slow = { sum: 0, count: 0, step: 0 };
    P = cutPuzzle({
      cols: meta.cols, rows: meta.rows, w: meta.w, h: meta.h, seed: meta.seed, seg: Q.seg,
    });
    P.t = P.unit * THICK;
    plane.constant = -P.t;
    finish = meta.done ? 1 : 0;
    [selected, floating, pointers, stale, easing, tinted].forEach((set) => set.clear());
    gesture = null;
    busy = 0;
    spinning += 1;
    [past, future, pending] = [[], [], null];
    told();
    const restored = restore(saved);
    if (!restored) scatter(meta.seed);
    stack(z);
    const mid = z.map((id) => centerOf(groups.get(id))).reduce(([x, y], [cx, cy]) => [x + cx / z.length, y + cy / z.length], [0, 0]);
    hung.home.set(mid[0], 0, mid[1]);
    if (restored && Array.isArray(saved.p) && saved.p.length === z.length) {
      z.forEach((id, k) => {
        const lie = saved.p[k];
        if (lie) Object.assign(groups.get(id), { y: lie[0], tilt: lie.length === 5 ? new THREE.Quaternion(lie[1], lie[2], lie[3], lie[4]).normalize() : null });
      });
    }
    Object.assign(view, {
      s: 1, cx: 0, cy: 0, r: 0,
    });
    quality();
    if (restored && saved.view) {
      Object.assign(view, {
        s: saved.view.s, cx: saved.view.cx, cy: saved.view.cy, r: saved.view.r || 0,
      });
    } else {
      fit(false);
    }
    sheet = printSheet(bitmap, P);
    bitmap.close?.();
    const most = 4 * 3 * Q.seg + 4;
    const mesh = new THREE.BatchedMesh(P.n, P.n * most * 4, P.n * (most * 12), new THREE.MeshStandardMaterial({ map: sheet.texture, roughness: 0.58, metalness: 0 }));
    Object.assign(mesh, { castShadow: true, receiveShadow: true, sortObjects: false });
    const step = clamp(Math.round(6000 / most), 30, 200);
    const build = async (start) => {
      if (mine !== token) throw new Error('cancelled');
      if (start >= P.n) return;
      range(start, Math.min(P.n, start + step)).forEach((i) => {
        const geometry = pieceGeometry(P.pieces[i], P, sheet.uv);
        mesh.addInstance(mesh.addGeometry(geometry));
        geometry.dispose();
      });
      onProgress(Math.min(1, (start + step) / P.n));
      await nextFrame();
      await build(start + step);
    };
    await build(0);
    batch = mesh;
    board.add(batch);
    dress();
    viewChanged();
    if (!restored && Q.physics === 'full' && P.n <= POUR_LIMIT) pour();
    if (finish) seal(0);
    render();
    return restored;
  };

  const unload = () => {
    token += 1;
    spinning += 1;
    clear();
    P = null;
    renderer.clear();
    pen.clearRect(0, 0, W, H);
  };

  const serialize = () => P && pieceGroup && ({
    v: 1,
    g: z.map((id) => {
      const g = groups.get(id);
      return [Math.round(g.tx * 10) / 10, Math.round(g.ty * 10) / 10, Math.round(g.a * 1e4) / 1e4, ...g.members];
    }),
    f: Array.from(face).join(''),
    p: z.map((id) => {
      const g = groups.get(id);
      const round = (v) => Math.round(v * 1e4) / 1e4;
      if (g.tilt) return [round(g.y), round(g.tilt.x), round(g.tilt.y), round(g.tilt.z), round(g.tilt.w)];
      return Math.abs(g.y - P.t / 2) > 0.01 ? [round(g.y)] : 0;
    }),
    view: {
      s: view.s, cx: view.cx, cy: view.cy, r: view.r,
    },
  });

  const stats = () => {
    const loose = [...groups.values()].filter((g) => g.members.length === 1).length;
    return { n: P.n, joined: groups.size === 1 ? P.n : P.n - loose, done: groups.size === 1 };
  };

  return {
    load,
    unload,
    serialize,
    stats,
    fit,
    present: async () => {
      const [g] = [...groups.values()];
      await spin(wrapAngle(-(g.a + view.r)));
      await fit();
      await seal(900);
    },
    key,
    undo,
    redo,
    spin: (da) => (gesture ? undefined : spin(da)),
    setTabletop: (top, tile) => {
      Object.assign(surface, { top, tile, line: top.tone === 'light' ? '27, 36, 33' : '242, 235, 221' });
      dress();
    },
    setTurning: (how) => Object.assign(turning, how),
    zoomBy: (f) => {
      if (!P) return;
      zoomAt(W / 2, H / 2, f);
      viewChanged();
    },
    zoomReset: async () => {
      if (!P) return;
      const from = view.s;
      await animate(260, (e) => {
        zoomAt(W / 2, H / 2, (from * (full() / from) ** e) / view.s);
        viewChanged();
      }, easeInOut);
    },
    release: () => {
      if (!selected.size) return;
      selected.clear();
      on.select(0);
      tint();
    },
    setView: (mode) => {
      if (view.mode === mode) return;
      view.mode = mode;
      if (P) viewChanged();
    },
    tier: () => Q.name,
    assist: (name) => (P && batch && !busy && !gesture ? assists[name]() : undefined),
  };
};

export const createShelf = ({ canvas, host }) => {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(22, 1, 10, 20000);
  const lamp = new THREE.DirectionalLight(0xffecd6, 2.6);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.5 }));
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a30, roughness: 0.6 });
  const card = new THREE.MeshStandardMaterial({ color: 0xe9e2d3, roughness: 0.8 });
  const boxes = new Map();
  const planks = [];
  const art = new Map();
  let raf = 0;
  let size = [0, 0];
  lamp.castShadow = true;
  lamp.shadow.mapSize.setScalar(2048);
  lamp.shadow.radius = 5;
  lamp.shadow.bias = -0.0005;
  wall.receiveShadow = true;
  scene.add(new THREE.HemisphereLight(0xfff3df, 0x2a3530, 0.75), lamp, lamp.target, wall);

  const draw = () => { raf = raf || requestAnimationFrame(paint); };
  const pictureOf = (src) => {
    if (!art.has(src)) {
      const img = Object.assign(new Image(), { crossOrigin: 'anonymous' });
      img.onload = () => {
        boxes.forEach((box) => box.src === src && print(box));
        draw();
      };
      img.src = src;
      art.set(src, img);
    }
    return art.get(src);
  };
  function print(box) {
    const k = 3;
    const [w, h] = [box.w * k, box.h * k];
    const c = Object.assign(box.face.image, { width: w, height: h });
    const ctx = c.getContext('2d');
    const img = pictureOf(box.src);
    const band = 34 * k;
    const [ax, ay, aw, ah] = [5 * k, 5 * k, w - 10 * k, h - band - 5 * k];
    ctx.fillStyle = '#f6f1e7';
    ctx.fillRect(0, 0, w, h);
    if (img.complete && img.naturalWidth) {
      const s = Math.max(aw / img.naturalWidth, ah / img.naturalHeight);
      ctx.drawImage(img, (img.naturalWidth - aw / s) / 2, (img.naturalHeight - ah / s) / 2, aw / s, ah / s, ax, ay, aw, ah);
    } else {
      ctx.fillStyle = '#14201c';
      ctx.fillRect(ax, ay, aw, ah);
    }
    ctx.fillStyle = '#1c2320';
    ctx.font = `600 ${15 * k}px Fraunces, Georgia, serif`;
    ctx.textBaseline = 'middle';
    const room = w - 70 * k;
    const name = [...box.name].reduce((out, ch) => (ctx.measureText(`${out}${ch}…`).width < room || out.endsWith('…') ? (out.endsWith('…') ? out : out + ch) : `${out}…`), '');
    ctx.fillText(name, 10 * k, h - band / 2 + k);
    const [sx, sy, sr] = [w - 33 * k, h - band - 2 * k, 23 * k];
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fillStyle = '#f6f1e7';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx, sy, sr - 2 * k, 0, Math.PI * 2);
    ctx.fillStyle = box.count ? '#b5432a' : '#1c2320';
    ctx.fill();
    ctx.fillStyle = '#fffdf8';
    ctx.textAlign = 'center';
    if (box.count) {
      ctx.font = `600 ${15 * k}px Fraunces, Georgia, serif`;
      ctx.fillText(box.count, sx, sy - 4 * k);
    }
    ctx.font = `600 ${7.5 * k}px "DM Sans", Arial, sans-serif`;
    ctx.fillText(box.count ? 'PIECES' : 'SEALED', sx, sy + (box.count ? 9 : 0) * k);
    ctx.textAlign = 'left';
    box.face.needsUpdate = true;
  }

  function paint() {
    raf = 0;
    const [W, H] = size;
    if (!W || !host.open) return;
    const d = H / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const mid = host.scrollTop + H / 2;
    Object.assign(camera, { aspect: W / H });
    camera.position.set(W / 2, -mid, d);
    camera.lookAt(W / 2, -mid, 0);
    camera.updateProjectionMatrix();
    lamp.target.position.set(W / 2, -mid, 0);
    lamp.position.set(W / 2 - W * 0.5, -mid + H * 0.9, d * 0.6);
    Object.assign(lamp.shadow.camera, {
      left: -W * 0.7, right: W * 0.7, top: H * 0.8, bottom: -H * 0.8, near: 10, far: d * 3,
    });
    lamp.shadow.camera.updateProjectionMatrix();
    wall.position.set(W / 2, -mid, 0);
    wall.scale.set(W * 2, H * 2, 1);
    boxes.forEach((box) => { box.mesh.position.z = box.deep / 2 + 26 + (box.hover ? 22 : 0); });
    renderer.render(scene, camera);
  }

  const update = () => {
    const frame = host.getBoundingClientRect();
    size = [frame.width, frame.height];
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(frame.width, frame.height, false);
    const seen = new Set();
    const rows = new Map();
    host.querySelectorAll('.box-open').forEach((el) => {
      const r = el.querySelector('.box-lid').getBoundingClientRect();
      const [x, y] = [r.left - frame.left, r.top - frame.top + host.scrollTop];
      const key = el.dataset.open ?? el.dataset.sealed;
      const data = {
        w: Math.round(r.width), h: Math.round(r.height), deep: Number(el.dataset.deep) * 3.2, src: el.dataset.art, name: el.dataset.name, count: el.dataset.count,
      };
      const old = boxes.get(key);
      const fresh = !old || ['w', 'h', 'src', 'name', 'count'].some((f) => old[f] !== data[f]);
      const box = old ?? { face: new THREE.CanvasTexture(document.createElement('canvas')), mesh: new THREE.Mesh() };
      if (!old) {
        box.face.colorSpace = THREE.SRGBColorSpace;
        box.face.anisotropy = 8;
        box.mesh.material = [card, card, card, card, new THREE.MeshStandardMaterial({ map: box.face, roughness: 0.55 }), card];
        Object.assign(box.mesh, { castShadow: true, receiveShadow: true });
        el.addEventListener('pointerenter', () => { box.hover = true; draw(); });
        el.addEventListener('pointerleave', () => { box.hover = false; draw(); });
        scene.add(box.mesh);
        boxes.set(key, box);
      }
      Object.assign(box, data);
      if (fresh) {
        box.mesh.geometry?.dispose();
        box.mesh.geometry = new THREE.BoxGeometry(box.w, box.h, box.deep);
        print(box);
      }
      box.mesh.position.set(x + box.w / 2, -(y + box.h / 2), 0);
      seen.add(key);
      const list = el.closest('.stack').getBoundingClientRect();
      rows.set(Math.round(y + r.height), [list.left - frame.left, list.width]);
    });
    [...boxes.keys()].filter((key) => !seen.has(key)).forEach((key) => {
      const box = boxes.get(key);
      scene.remove(box.mesh);
      box.mesh.geometry.dispose();
      box.face.dispose();
      boxes.delete(key);
    });
    planks.splice(0).forEach((mesh) => {
      scene.remove(mesh);
      mesh.geometry.dispose();
    });
    rows.forEach(([left, width], bottom) => {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(width, 16, 130), wood);
      plank.position.set(left + width / 2, -(bottom + 8), 65);
      Object.assign(plank, { castShadow: true, receiveShadow: true });
      scene.add(plank);
      planks.push(plank);
    });
    draw();
  };
  host.addEventListener('scroll', draw, { passive: true });
  new ResizeObserver(() => host.open && update()).observe(host);
  return { update };
};
