// Core 3D game engine + round orchestration.
//
// Modes: lobby (cinematic) -> prelude (insertion) -> play <-> decision
//        -> dying | extract
//
// The betting outcome (drawn in rtp.js) is authoritative. Combat is staged
// around it: enemies can only land hits during the scripted bust step, and
// comrades guarantee progress when the player doesn't shoot.

import * as THREE from 'three';
import { generateMap } from './mapgen.js';
import { buildWorld } from './world.js';
import { Effects, sound } from './effects.js';
import { EnemyBot, Comrade } from './bots.js';
import { makeVehicle } from './models.js';
import { Controls, IS_TOUCH } from './controls.js';
import { makeRng } from '../rng.js';

const EYE = 1.62;
const PLAYER_RADIUS = 0.45;
const WALK_SPEED = 4.6;
const FIRE_INTERVAL = 1 / 7.5;
const MAG_SIZE = 30;
const RELOAD_TIME = 1.35;
const FRAG_COOLDOWN = 4.5;
const BASE_FOV = 75;
const SCOPE_FOV = 32;

const COMRADE_SLOTS = [
  { x: -1.25, z: -1.7 },
  { x: 1.25, z: -1.7 },
  { x: 0, z: -2.9 }
];

const tmpV = new THREE.Vector3();

export class Game {
  constructor(canvas, controlUi) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 400);
    this.effects = new Effects(this.scene);
    this.controls = new Controls(canvas, controlUi);
    this.controls.onFrag = () => this.throwFrag();
    this.controls.onScopeChange = (v) => {
      this.targetFov = v ? SCOPE_FOV : BASE_FOV;
      this.cb.onScope?.(v);
    };

    this.clock = new THREE.Clock();
    this.mode = 'idle';
    this.world = null;
    this.map = null;
    this.mission = null;
    this.enemies = [];
    this.comrades = [];
    this.grenades = [];
    this.vehicle = null;

    this.cb = {}; // callbacks wired by main.js

    this.player = {
      pos: new THREE.Vector3(),
      yaw: 0,
      health: 100,
      ammo: MAG_SIZE,
      reload: 0,
      fireTimer: 0,
      fragTimer: 0,
      bob: 0
    };

    this.round = null;
    this.targetFov = BASE_FOV;
    this.shake = 0;
    this.lobbyT = 0;

    addEventListener('resize', () => this.resize());
    this.resize();

    this._raf = this._raf ?? requestAnimationFrame(() => this.loop());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------- mission

  setMission(mission) {
    this.disposeWorld();
    this.mission = mission;
    const rng = makeRng(mission.seed ^ 0x5f3759df);
    this.map = generateMap(rng);
    this.world = buildWorld(this.scene, this.map, mission.location.env, rng);
    this.spawnEnemies(rng);
    this.mode = 'lobby';
    this.lobbyT = 0;
  }

  spawnEnemies(rng) {
    const S = this.map.cellSize;
    for (let seg = 1; seg <= this.map.segments; seg++) {
      const segCells = this.map.path.filter((p) => p.seg === seg);
      if (segCells.length < 2) continue;
      const count = seg === this.map.segments ? 4 : rng.int(2, 4);
      for (let i = 0; i < count; i++) {
        const idx = rng.int(Math.floor(segCells.length / 3), segCells.length - 1);
        const cell = segCells[idx];
        const pos = new THREE.Vector3(
          cell.x * S + rng.range(-1.6, 1.6), 0, cell.z * S + rng.range(-1.6, 1.6)
        );
        let patrolTo = null;
        const nb = segCells[Math.max(0, idx - 1)];
        if (nb && rng.chance(0.7)) {
          patrolTo = new THREE.Vector3(nb.x * S + rng.range(-1, 1), 0, nb.z * S + rng.range(-1, 1));
        }
        this.enemies.push(new EnemyBot(this.scene, pos, patrolTo, seg));
      }
    }
  }

  disposeWorld() {
    if (this.world) {
      this.scene.remove(this.world);
      this.world.traverse((o) => {
        o.geometry?.dispose?.();
        if (o.material) {
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose?.());
        }
      });
      this.world = null;
    }
    for (const e of this.enemies) e.dispose();
    this.enemies = [];
    for (const c of this.comrades) c.dispose();
    this.comrades = [];
    for (const g of this.grenades) this.scene.remove(g.mesh);
    this.grenades = [];
    if (this.vehicle) { this.scene.remove(this.vehicle); this.vehicle = null; }
    if (this.viewmodel) { this.camera.remove(this.viewmodel); }
    this.effects.clear();
    this.scene.remove(this.camera);
  }

  // ------------------------------------------------------------- round

  startRound({ bet, plan }) {
    this.round = {
      bet,
      plan,                    // { mults, bustStep }
      step: 1,
      pot: bet,
      kills: 0,
      segKills: 0,
      segEnemyTotal: 0,
      segTime: 0,
      lethalHits: 0,
      over: false
    };
    this.deathReported = false;
    this.player.health = 100;
    this.player.ammo = MAG_SIZE;
    this.player.reload = 0;
    this.player.fragTimer = 0;

    const start = this.map.path[0];
    const next = this.map.path[1] ?? start;
    const S = this.map.cellSize;
    this.player.pos.set(start.x * S, EYE, start.z * S);
    this.player.yaw = Math.atan2((next.x - start.x), (next.z - start.z)) + Math.PI; // yaw convention: forward = -Z rotated
    this.controls.yaw = Math.atan2(-(next.x - start.x), -(next.z - start.z));
    this.controls.pitch = 0;

    this.spawnComrades();
    this.buildViewmodel();
    this.startPrelude();
  }

  spawnComrades() {
    const S = this.map.cellSize;
    const start = this.map.path[0];
    for (let i = 0; i < COMRADE_SLOTS.length; i++) {
      const c = new Comrade(this.scene, this.mission.team.camo, this.mission.roster[i]);
      c.setPosition(new THREE.Vector3(start.x * S + COMRADE_SLOTS[i].x, 0, start.z * S + COMRADE_SLOTS[i].z), this.controls.yaw);
      this.comrades.push(c);
    }
  }

  buildViewmodel() {
    if (this.viewmodel) this.camera.remove(this.viewmodel);
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0x191c21 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.55), mat);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.07), mat);
    grip.position.set(0, -0.09, 0.12);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.1), mat);
    sight.position.set(0, 0.07, 0.05);
    const hands = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.1), new THREE.MeshLambertMaterial({ color: this.mission.team.camo.cloth }));
    hands.position.set(0, -0.06, -0.12);
    g.add(body, grip, sight, hands);
    g.position.set(0.22, -0.2, -0.45);
    this.viewmodel = g;
    this.camera.add(g);
    this.scene.add(this.camera);
  }

  startPrelude() {
    this.mode = 'prelude';
    this.preludeT = 0;
    const type = this.mission.team.vehicle;
    this.vehicle = makeVehicle(type);
    this.scene.add(this.vehicle);
    this.preludeKind = type === 'parachute' ? 'drop' : 'drive';
    this.preludeDur = this.preludeKind === 'drop' ? 5.2 : 4.6;
    sound.step();
  }

  updatePrelude(dt) {
    this.preludeT += dt;
    const t = Math.min(1, this.preludeT / this.preludeDur);
    const ease = t * t * (3 - 2 * t);
    const start = this.player.pos;
    const yaw = this.controls.yaw;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));

    if (this.preludeKind === 'drop') {
      const alt = (1 - ease) * 55;
      this.camera.position.set(start.x, EYE + alt, start.z);
      this.camera.position.x += Math.sin(this.preludeT * 1.3) * (1 - t) * 2.2;
      this.camera.position.z += Math.cos(this.preludeT * 1.1) * (1 - t) * 2.2;
      this.camera.rotation.set(-0.5 * (1 - t), yaw, Math.sin(this.preludeT) * 0.06 * (1 - t), 'YXZ');
      this.vehicle.position.copy(this.camera.position);
      this.vehicle.position.y -= 1.4;
      this.vehicle.rotation.y = yaw;
      this.vehicle.visible = t < 0.97;
    } else {
      const dist = (1 - ease) * 42;
      const vpos = tmpV.copy(start).addScaledVector(fwd, -dist - 1.5);
      const bob = Math.sin(this.preludeT * 9) * 0.05 * (1 - t) + Math.sin(this.preludeT * 2.2) * 0.08;
      this.vehicle.position.set(vpos.x, 0, vpos.z);
      this.vehicle.rotation.y = yaw + Math.PI;
      this.camera.position.set(vpos.x, EYE + 0.35 + bob, vpos.z);
      this.camera.rotation.set(0, yaw, Math.sin(this.preludeT * 3) * 0.015 * (1 - t), 'YXZ');
    }

    if (t >= 1) {
      // dismount
      if (this.preludeKind === 'drop') this.vehicle.visible = false;
      this.mode = 'play';
      this.round.segTime = 0;
      this.beginSegment(1, true);
      this.controls.enable();
      this.cb.onDismount?.();
    }
  }

  beginSegment(step, first = false) {
    const r = this.round;
    r.step = step;
    r.segTime = 0;
    r.segKills = 0;
    r.lethal = r.plan.bustStep === step;
    const segEnemies = this.enemies.filter((e) => e.seg === step && e.alive);
    r.segEnemyTotal = segEnemies.length;
    for (const e of segEnemies) e.engageDelay = 0.7 + Math.random() * 1.2;
    if (!first) sound.step();
    this.cb.onSegmentStart?.(step, r.lethal);
  }

  currentRoomCenter() {
    const room = this.map.rooms[this.round.step - 1];
    if (!room) return null;
    const S = this.map.cellSize;
    return new THREE.Vector3(room.x * S, 0, room.z * S);
  }

  // called by UI after a decision choice
  resumeAfterDecision() {
    if (this.mode !== 'decision') return;
    this.mode = 'play';
    this.controls.enable();
    if (!IS_TOUCH) this.controls.requestPointerLock();
    this.beginSegment(this.round.step + 1);
  }

  cashOut() {
    if (this.mode !== 'decision' || this.round.over) return 0;
    const r = this.round;
    r.over = true;
    const payout = r.bet * r.plan.mults[r.step - 1];
    this.mode = 'extract';
    this.controls.disable();
    sound.cash();
    this.cb.onRoundEnd?.({ result: 'cashout', payout, step: r.step, kills: r.kills });
    return payout;
  }

  // ------------------------------------------------------------- combat

  tryFire(dt) {
    const p = this.player;
    p.fireTimer -= dt;
    if (p.reload > 0) {
      p.reload -= dt;
      if (p.reload <= 0) {
        p.ammo = MAG_SIZE;
        this.cb.onAmmo?.(p.ammo, false);
      }
      return;
    }
    if (!this.controls.firing || p.fireTimer > 0) return;
    p.fireTimer = FIRE_INTERVAL;
    if (p.ammo <= 0) return;
    p.ammo--;
    if (p.ammo === 0) {
      p.reload = RELOAD_TIME;
      this.cb.onAmmo?.(0, true);
    } else {
      this.cb.onAmmo?.(p.ammo, false);
    }

    sound.shot();
    this.shake = Math.min(this.shake + 0.12, 0.5);
    if (this.viewmodel) this.viewmodel.position.z = -0.4; // kick, eased back in update

    // raycast from camera center
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: 0, y: 0 }, this.camera);
    ray.far = 90;
    const targets = this.enemies.filter((e) => e.alive).map((e) => e.group);
    const hits = ray.intersectObjects(targets, true);

    const muzzle = new THREE.Vector3();
    this.camera.getWorldPosition(muzzle);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    muzzle.addScaledVector(dir, 0.6).add(tmpV.set(dir.z, -0.12, -dir.x).multiplyScalar(0.18));

    let end;
    if (hits.length > 0) {
      end = hits[0].point;
      const bot = hits[0].object.userData.soldierRoot?.userData.enemyId;
      const enemy = this.enemies.find((e) => e.id === bot);
      if (enemy) {
        enemy.engage();
        const died = enemy.takeHit(this.effects);
        sound.hit();
        if (died) this.registerKill(enemy, 'player');
      }
    } else {
      end = muzzle.clone().addScaledVector(dir, 90);
    }
    this.effects.tracer(muzzle, end, true);
    this.effects.muzzleFlash(muzzle, dir);
  }

  throwFrag() {
    if (this.mode !== 'play') return;
    const p = this.player;
    if (p.fragTimer > 0) return;
    p.fragTimer = FRAG_COOLDOWN;
    this.cb.onFrag?.(FRAG_COOLDOWN);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0x2c3a2a })
    );
    mesh.position.copy(this.camera.position).addScaledVector(dir, 0.5);
    this.scene.add(mesh);
    this.grenades.push({
      mesh,
      vel: dir.clone().multiplyScalar(13).add(new THREE.Vector3(0, 4.5, 0)),
      fuse: 1.5
    });
    sound.click();
  }

  updateGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt;
      g.vel.y -= 22 * dt;
      g.mesh.position.addScaledVector(g.vel, dt);
      if (g.mesh.position.y < 0.1) {
        g.mesh.position.y = 0.1;
        g.vel.y = Math.abs(g.vel.y) * 0.35;
        g.vel.x *= 0.7; g.vel.z *= 0.7;
      }
      if (g.fuse <= 0) {
        this.effects.explosion(g.mesh.position);
        sound.explosion();
        this.shake = 0.7;
        for (const e of this.enemies) {
          if (e.alive && e.group.position.distanceTo(g.mesh.position) < 5.5) {
            e.takeHit(this.effects);
            const died = e.takeHit(this.effects);
            if (died || !e.alive) this.registerKill(e, 'player');
          }
        }
        this.scene.remove(g.mesh);
        this.grenades.splice(i, 1);
      }
    }
  }

  registerKill(enemy, by) {
    const r = this.round;
    if (!r || r.over) return;
    if (enemy.seg === r.step) r.segKills++;
    if (by === 'player') {
      r.kills++;
      this.cb.onKill?.(r.kills);
    }
  }

  applyPlayerHit(scale) {
    const r = this.round;
    if (!r || !r.lethal || this.mode !== 'play') return;
    this.player.health -= (9 + Math.random() * 7) * scale;
    this.shake = Math.min(this.shake + 0.35, 0.9);
    sound.alarm();
    this.cb.onHealth?.(Math.max(0, this.player.health));
    if (this.player.health <= 0) this.startDying();
  }

  startDying() {
    const r = this.round;
    r.over = true;
    this.mode = 'dying';
    this.dyingT = 0;
    this.controls.disable();
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  // ------------------------------------------------------------- movement

  updatePlayerMovement(dt) {
    const c = this.controls;
    // touch aim
    if (IS_TOUCH) {
      const rate = c.aimRate;
      c.yaw += rate.yaw * dt;
      c.pitch = THREE.MathUtils.clamp(c.pitch + rate.pitch * dt, -1.35, 1.35);
    }
    this.player.yaw = c.yaw;

    const yaw = c.yaw;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = new THREE.Vector3()
      .addScaledVector(fwd, c.move.z)
      .addScaledVector(right, c.move.x);
    const len = wish.length();
    if (len > 1) wish.divideScalar(len);
    const speed = WALK_SPEED * (c.scoped ? 0.55 : 1);

    const p = this.player.pos;
    const step = wish.multiplyScalar(speed * dt);
    // axis-separated collision against uncarved cells
    const tryAxis = (dx, dz) => {
      const nx = p.x + dx, nz = p.z + dz;
      const pts = [
        [nx + PLAYER_RADIUS, nz], [nx - PLAYER_RADIUS, nz],
        [nx, nz + PLAYER_RADIUS], [nx, nz - PLAYER_RADIUS]
      ];
      for (const [px, pz] of pts) {
        const cell = this.map.cellAt(px, pz);
        if (!this.map.isCarved(cell.x, cell.z)) return false;
      }
      p.x = nx; p.z = nz;
      return true;
    };
    tryAxis(step.x, 0);
    tryAxis(0, step.z);

    // view bob
    const moving = len > 0.05;
    this.player.bob += dt * (moving ? 9 : 2);
    const bobAmp = moving && !c.scoped ? 0.045 : 0.008;

    this.camera.position.set(p.x, EYE + Math.sin(this.player.bob) * bobAmp, p.z);
    this.camera.rotation.set(c.pitch, c.yaw, 0, 'YXZ');
  }

  // ------------------------------------------------------------- pot / flow

  updatePlayFlow(dt) {
    const r = this.round;
    r.segTime += dt;

    // engage current-segment enemies
    const playerPos = this.player.pos;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.seg === r.step) {
        e.engageDelay -= dt;
        if (e.engageDelay <= 0) e.engage();
        e.engagedFor = (e.engagedFor ?? 0) + (e.state === 'combat' ? dt : 0);
      } else if (e.seg === r.step + 1 && e.group.position.distanceTo(playerPos) < this.map.cellSize * 1.6) {
        // early birds near the room edge open up too
        e.engage();
      }
    }

    // pot presentation: creep toward the next rung with kills + progress
    const prevMult = r.step === 1 ? 1 : r.plan.mults[r.step - 2];
    const nextMult = r.plan.mults[r.step - 1];
    const killFrac = r.segEnemyTotal > 0 ? r.segKills / r.segEnemyTotal : 1;
    const room = this.currentRoomCenter();
    let distFrac = 0;
    if (room) {
      const segCells = this.map.path.filter((p) => p.seg === r.step);
      const segStart = segCells[0];
      const S = this.map.cellSize;
      const total = Math.hypot(room.x - segStart.x * S, room.z - segStart.z * S) || 1;
      const left = Math.hypot(room.x - playerPos.x, room.z - playerPos.z);
      distFrac = THREE.MathUtils.clamp(1 - left / total, 0, 1);
    }
    const frac = THREE.MathUtils.clamp(killFrac * 0.55 + distFrac * 0.45, 0, 0.98);
    const targetPot = r.bet * (prevMult + (nextMult - prevMult) * frac);
    r.pot += (targetPot - r.pot) * Math.min(1, dt * 3);
    this.cb.onPot?.(r.pot, nextMult * r.bet);

    // health regen outside the bust step
    if (!r.lethal && this.player.health < 100) {
      this.player.health = Math.min(100, this.player.health + dt * 20);
      this.cb.onHealth?.(this.player.health);
    }

    // bust-step pressure: if the player camps or is about to slip through,
    // keep the scripted hits coming
    if (r.lethal && r.segTime > 3 && Math.random() < dt * 0.8) {
      this.applyPlayerHit(0.6);
    }

    // reaching the decision room
    if (room) {
      const d = Math.hypot(room.x - playerPos.x, room.z - playerPos.z);
      if (d < this.map.cellSize * 0.85) {
        if (r.lethal) {
          // ambushed at the threshold — the round was always ending here
          this.applyPlayerHit(1.4);
        } else if (r.step >= this.map.segments) {
          this.finishRoundWin();
        } else {
          this.enterDecision();
        }
      }
    }
  }

  enterDecision() {
    const r = this.round;
    r.pot = r.bet * r.plan.mults[r.step - 1];
    this.cb.onPot?.(r.pot, r.pot);
    this.mode = 'decision';
    this.controls.disable();
    if (document.pointerLockElement) document.exitPointerLock?.();
    sound.step();
    this.cb.onDecision?.(r.step, r.pot);
  }

  finishRoundWin() {
    const r = this.round;
    r.over = true;
    r.pot = r.bet * r.plan.mults[this.map.segments - 1];
    this.mode = 'extract';
    this.controls.disable();
    if (document.pointerLockElement) document.exitPointerLock?.();
    sound.cash();
    this.cb.onRoundEnd?.({ result: 'extracted', payout: r.pot, step: this.map.segments, kills: r.kills });
  }

  updateDying(dt) {
    this.dyingT += dt;
    const t = Math.min(1, this.dyingT / 1.5);
    this.camera.position.y = EYE - t * (EYE - 0.35);
    this.camera.rotation.z = t * 0.6;
    this.camera.rotation.x += dt * 0.25 * (1 - t);
    if (this.dyingT > 2.1 && !this.deathReported) {
      this.deathReported = true;
      this.cb.onRoundEnd?.({
        result: 'kia', payout: 0, step: this.round.step, kills: this.round.kills
      });
    }
  }

  // ------------------------------------------------------------- lobby cam

  updateLobbyCam(dt) {
    this.lobbyT += dt;
    const S = this.map.cellSize;
    const mid = this.map.path[Math.floor(this.map.path.length / 2)];
    const cx = mid.x * S, cz = mid.z * S;
    const a = this.lobbyT * 0.07;
    const rad = 26;
    this.camera.position.set(cx + Math.cos(a) * rad, 15 + Math.sin(this.lobbyT * 0.21) * 3.5, cz + Math.sin(a) * rad);
    this.camera.lookAt(cx, 1, cz);
  }

  // ------------------------------------------------------------- main loop

  loop() {
    requestAnimationFrame(() => this.loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (!this.world) return;

    // fov ease (scope)
    if (Math.abs(this.camera.fov - this.targetFov) > 0.1) {
      this.camera.fov += (this.targetFov - this.camera.fov) * Math.min(1, dt * 10);
      this.camera.updateProjectionMatrix();
    }

    // effects and world dressing
    this.effects.update(dt);
    const ring = this.world.getObjectByName('exfilRing');
    if (ring) {
      ring.material.opacity = 0.4 + Math.sin(performance.now() * 0.004) * 0.25;
    }

    const playing = this.mode === 'play';
    const enemyCtx = {
      playerPos: this.player.pos,
      effects: this.effects,
      lethal: false,
      onPlayerHit: (s) => this.applyPlayerHit(s)
    };

    switch (this.mode) {
      case 'lobby': {
        this.updateLobbyCam(dt);
        for (const e of this.enemies) e.update(dt, enemyCtx);
        break;
      }
      case 'prelude': {
        this.updatePrelude(dt);
        for (const e of this.enemies) e.update(dt, enemyCtx);
        break;
      }
      case 'play': {
        this.updatePlayerMovement(dt);
        this.player.fragTimer = Math.max(0, this.player.fragTimer - dt);
        this.tryFire(dt);
        this.updateGrenades(dt);
        this.updatePlayFlow(dt);

        const r = this.round;
        for (const e of this.enemies) {
          e.update(dt, {
            ...enemyCtx,
            lethal: r.lethal && e.seg === r.step
          });
        }
        this.updateComrades(dt, true);

        // viewmodel kick recovery + sway
        if (this.viewmodel) {
          this.viewmodel.position.z += (-0.45 - this.viewmodel.position.z) * Math.min(1, dt * 14);
          const targetX = this.controls.scoped ? 0.0 : 0.22;
          const targetY = (this.controls.scoped ? -0.12 : -0.2) + Math.sin(this.player.bob) * 0.006;
          this.viewmodel.position.x += (targetX - this.viewmodel.position.x) * Math.min(1, dt * 10);
          this.viewmodel.position.y += (targetY - this.viewmodel.position.y) * Math.min(1, dt * 10);
        }
        break;
      }
      case 'decision': {
        for (const e of this.enemies) e.update(dt, enemyCtx);
        this.updateComrades(dt, false);
        this.camera.position.set(this.player.pos.x, EYE, this.player.pos.z);
        this.camera.rotation.set(this.controls.pitch, this.controls.yaw, 0, 'YXZ');
        break;
      }
      case 'dying': {
        this.updateDying(dt);
        for (const e of this.enemies) e.update(dt, enemyCtx);
        break;
      }
      case 'extract': {
        for (const e of this.enemies) e.update(dt, enemyCtx);
        this.updateComrades(dt, false);
        break;
      }
    }

    // camera shake decay
    if (this.shake > 0.001 && this.mode !== 'lobby') {
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.14;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.14;
      this.shake *= Math.pow(0.02, dt);
    }

    this.renderer.render(this.scene, this.camera);
  }

  updateComrades(dt, combat) {
    const r = this.round;
    for (let i = 0; i < this.comrades.length; i++) {
      this.comrades[i].update(dt, {
        playerPos: this.player.pos,
        playerYaw: this.controls.yaw,
        slot: COMRADE_SLOTS[i],
        enemies: combat ? this.enemies.filter((e) => e.seg === r.step || e.state === 'combat') : [],
        effects: this.effects,
        graceElapsed: combat && r.segTime > 4.5,
        onComradeKill: (e) => this.registerKill(e, 'comrade')
      });
    }
  }
}
