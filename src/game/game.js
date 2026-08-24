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
import { optionStats } from '../rtp.js';
import { RISK_FACTORS } from '../config.js';
import { buildWorld } from './world.js';
import { Effects, sound } from './effects.js';
import { EnemyBot, Comrade } from './bots.js';
import { makeVehicle, makeCar, makeCivilian, makeObjectiveProp, makeGate, makeBackupViewmodel, makeWeaponViewmodel, makeRiggedViewmodel, makeThrownWeapon, animateWalk, poseIdle, poseFire, poseSit, syncWeaponStance } from './models.js';

// Squad backup weapons (hold FIRE on mobile / N on desktop to switch)
const BACKUPS = {
  harpoon: { name: 'HARPOON GUN', ammo: 10, interval: 1.1 },
  knife: { name: 'BALLISTIC KNIFE', ammo: 10, interval: 0.7 },
  flashgl: { name: 'FLASH 40MM', ammo: 6, interval: 1.25 },
  shotgun: { name: 'COMBAT SHOTGUN', ammo: 14, interval: 0.95 },
  rpg: { name: 'RPG', ammo: 5, interval: 1.6 }
};
import { Controls, IS_TOUCH } from './controls.js';
import { makeRng } from '../rng.js';

const EYE = 1.55; // matches the (scaled) soldier models' eye line
const PLAYER_RADIUS = 0.55;
const WALK_SPEED = 4.6;
const FIRE_INTERVAL = 1 / 7.5;
const MAG_SIZE = 30;
const RELOAD_TIME = 1.35;
const FRAG_COOLDOWN = 4.5;
const BASE_FOV = 75;
const SCOPE_FOV = 32;

const COLUMN_SPACING = 2.7; // metres between men in the file

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

export class Game {
  constructor(canvas, controlUi) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = IS_TOUCH ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 400);
    this.effects = new Effects(this.scene);
    this.controls = new Controls(canvas, controlUi);
    this.controls.onFrag = () => this.throwFrag();
    this.controls.onWeaponSwitch = () => this.switchWeapon();
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
    this.projectiles = []; // backup-weapon rounds (bolts, knives, rockets…)
    this.destructibles = []; // set-piece cars / barricades
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
    this.map = generateMap(rng, { segments: mission.steps ?? 8 });
    const S = this.map.cellSize;
    this.routePts = this.map.route.map((c) => new THREE.Vector3(c.x * S, 0, c.z * S));
    this.pillarSet = new Set((this.map.pillars ?? []).map((p) => `${p.x},${p.z}`));
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
        this.enemies.push(new EnemyBot(this.scene, pos, patrolTo, seg, { weapon: this.enemyWeapon() }));
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
    for (const pr of this.projectiles) this.scene.remove(pr.mesh);
    this.projectiles = [];
    for (const d of this.destructibles) this.scene.remove(d.group);
    this.destructibles = [];
    this.clearLockedGates();
    if (this.npc) { this.npc.dispose(); this.npc = null; }
    if (this.objective?.beacon) this.scene.remove(this.objective.beacon);
    this.objective = null;
    if (this.gatePhase) {
      for (const g of this.gatePhase.gates) this.scene.remove(g);
      this.gatePhase = null;
    }
    if (this.vehicle) { this.scene.remove(this.vehicle); this.vehicle = null; }
    if (this.preludeChutes) {
      for (const c of this.preludeChutes) this.scene.remove(c);
      this.preludeChutes = null;
    }
    if (this.preludePlane) {
      this.scene.remove(this.preludePlane);
      this.preludePlane = null;
    }
    this.prelude = null;
    if (this.viewmodel) { this.camera.remove(this.viewmodel); }
    this.effects.clear();
    this.scene.remove(this.camera);
  }

  // ------------------------------------------------------------- round

  startRound({ bet, plan, rng }) {
    this.rng = rng; // fresh-entropy chance() for per-step outcome draws
    this.round = {
      bet,
      plan,                    // { mults, survival, gains, steps }
      step: 1,
      // rung bookkeeping: curRung = multiplier secured at the last
      // checkpoint; rungTarget = what the current step is playing for.
      // Route-option risk modifies each step's (p, gain) EV-neutrally.
      curRung: 0,
      rungTarget: plan.mults[0],
      pendingBust: !rng.chance(plan.survival[0]),
      pot: 0,
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

    // commander's position in the 4-man column rotates every round: 1st-3rd
    this.playerSlot = Math.floor(Math.random() * 3);
    this.comradeSlots = [0, 1, 2, 3].filter((s) => s !== this.playerSlot);

    // seed the breadcrumb trail backwards so trailing men start in file
    const yaw = this.controls.yaw;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.trail = [];
    for (let d = 14; d >= 0.5; d -= 0.7) {
      this.trail.push(new THREE.Vector3(this.player.pos.x - fwd.x * d, 0, this.player.pos.z - fwd.z * d));
    }

    this.spawnComrades(fwd);
    this.buildViewmodel();
    this.startPrelude();
  }

  spawnComrades(fwd) {
    const start = this.player.pos;
    for (let i = 0; i < this.comradeSlots.length; i++) {
      const colOffset = this.comradeSlots[i] - this.playerSlot; // <0 ahead, >0 behind
      const c = new Comrade(this.scene, this.mission.team.camo, this.mission.roster[i], null,
        {
          headgear: this.mission.team.gear,
          backupWeapon: { harpoon: 'harpoon', knife: 'knife', flashgl: 'flashgl', shotgun: 'shotgun', rpg: 'rpg' }[this.mission.team.backup] ?? null
        });
      c.setPosition(
        new THREE.Vector3(start.x - fwd.x * colOffset * COLUMN_SPACING, 0, start.z - fwd.z * colOffset * COLUMN_SPACING),
        this.controls.yaw + Math.PI
      );
      this.comrades.push(c);
    }
  }

  // point `dist` metres behind the commander along their breadcrumb trail
  trailBehindPoint(dist) {
    let head = tmpV2.set(this.player.pos.x, 0, this.player.pos.z);
    let acc = 0;
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const p = this.trail[i];
      const segLen = head.distanceTo(p);
      if (acc + segLen >= dist && segLen > 0.001) {
        const t = (dist - acc) / segLen;
        return new THREE.Vector3().lerpVectors(head, p, t);
      }
      acc += segLen;
      head = p;
    }
    return head.clone();
  }

  // point `dist` metres ahead of the commander along the mission route
  routeAheadPoint(dist) {
    const R = this.routePts;
    if (!R || R.length === 0) return this.player.pos.clone().setY(0);
    let bestI = 0, bestD = Infinity;
    for (let i = 0; i < R.length; i++) {
      const d = R[i].distanceToSquared(this.player.pos);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    let acc = 0;
    let head = R[bestI];
    for (let i = bestI + 1; i < R.length; i++) {
      const segLen = head.distanceTo(R[i]);
      if (acc + segLen >= dist && segLen > 0.001) {
        const t = (dist - acc) / segLen;
        return new THREE.Vector3().lerpVectors(head, R[i], t);
      }
      acc += segLen;
      head = R[i];
    }
    return head.clone();
  }

  switchWeapon() {
    if (this.mode !== 'play' || !this.round) return;
    this.weaponMode = this.weaponMode === 'backup' ? 'primary' : 'backup';
    const backup = BACKUPS[this.mission.team.backup];
    if (this.viewmodelPrimary) this.viewmodelPrimary.visible = this.weaponMode === 'primary';
    if (this.viewmodelBackup) this.viewmodelBackup.visible = this.weaponMode === 'backup';
    this.viewmodel = this.weaponMode === 'backup' ? this.viewmodelBackup : this.viewmodelPrimary;
    sound.click();
    if (this.weaponMode === 'backup') {
      this.cb.onWeapon?.(backup.name, this.backupAmmo);
    } else {
      this.cb.onWeapon?.('RIFLE', this.player.ammo);
    }
  }

  // Drive the rigged viewmodel arms from the player's weapon state, using
  // the same baked clips the squad and enemies play.
  updateViewmodelPose(dt) {
    const vm = this.viewmodel;
    const rig = vm?.userData?.rig;
    if (!rig?.play) return;
    vm.userData.tick?.(dt);
    this.vmFireT = Math.max(0, (this.vmFireT ?? 0) - dt);
    // the ballistic-knife viewmodel carries one-handed (upper-body stance
    // overlay) and throws instead of pulling a trigger
    const knife = syncWeaponStance(vm);
    if (this.player.reload > 0 && !knife) rig.play('reload', { fade: 0.12 });
    else if (this.vmFireT > 0 && knife) poseFire(vm);
    else if (this.vmFireT > 0) rig.play('fire', { fade: 0.05 });
    else rig.play('aim', { fade: 0.16 });
    // the weapon was fitted in the bind pose; once the carry stance has
    // settled, re-align the barrel to the crosshair from the live pose.
    // The knife carry is a raised one-handed grip — re-aligning the blade
    // to the crosshair there would twist it out of the hand.
    if (!vm.userData.aligned && !knife) {
      vm.userData.alignT = (vm.userData.alignT ?? 0) + dt;
      if (vm.userData.alignT > 0.45) {
        vm.userData.aligned = true;
        rig.alignWeapon?.();
      }
    }
  }

  buildViewmodel() {
    if (this.viewmodel) this.camera.remove(this.viewmodel);
    if (this.viewmodelBackup) this.camera.remove(this.viewmodelBackup);
    const camo = this.mission.team.camo;
    let g = makeRiggedViewmodel(camo, 'rifle') ?? makeWeaponViewmodel('rifle', camo);
    if (!g) {
      // procedural fallback when the baked weapon set is unavailable
      g = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color: 0x191c21 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.55), mat);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.07), mat);
      grip.position.set(0, -0.09, 0.12);
      const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.1), mat);
      sight.position.set(0, 0.07, 0.05);
      const hands = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.1), new THREE.MeshLambertMaterial({ color: camo.cloth }));
      hands.position.set(0, -0.06, -0.12);
      g.add(body, grip, sight, hands);
    }
    const rigged = !!g.userData.rig;
    // the rigged body already holds the weapon in a natural pose, so it
    // only needs a small offset; the procedural fallback is placed by hand
    this.vmBase = rigged
      ? new THREE.Vector3(0.02, -0.02, 0)
      : new THREE.Vector3(0.24, -0.22, -0.5);
    g.position.copy(this.vmBase);
    this.viewmodel = g;
    this.viewmodelPrimary = g;
    this.camera.add(g);

    const backupWeapon = { harpoon: 'harpoon', knife: 'knife', flashgl: 'flashgl', shotgun: 'shotgun', rpg: 'rpg' }[this.mission.team.backup];
    const backup = (rigged && makeRiggedViewmodel(camo, backupWeapon))
      ?? makeBackupViewmodel(this.mission.team.backup, camo);
    backup.position.copy(this.vmBase);
    backup.visible = false;
    this.viewmodelBackup = backup;
    this.camera.add(backup);

    this.weaponMode = 'primary';
    this.backupAmmo = BACKUPS[this.mission.team.backup].ammo;
    // weapon stays slung during the insertion ride; raised at the breach
    g.visible = false;
    // classic FPS trick: the viewmodel ignores the depth buffer so the
    // barrel never clips into walls when hugging cover
    for (const vm of [g, backup]) {
      vm.traverse((o) => {
        if (o.isMesh) {
          o.material.depthTest = false;
          o.renderOrder = 500;
        }
      });
    }
    this.scene.add(this.camera);
  }

  // ------------------------------------------------------------- prelude
  //
  // Insertion cutscene: ride in with the squad seated around you (heads
  // turning, idling), pull up on a curved approach OUTSIDE the compound,
  // dismount, stack on the perimeter gate, breach, and walk in — then a
  // seamless handoff to first-person control at the spawn cell.

  startPrelude() {
    this.mode = 'prelude';
    const type = this.mission.team.vehicle;
    const S = this.map.cellSize;
    const b = this.map.bounds;
    const yaw = this.controls.yaw;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const lat = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const start = new THREE.Vector3(this.player.pos.x, 0, this.player.pos.z);

    let dWall = 42;
    if (fwd.z > 0.5) dWall = start.z - (b.minZ - 4) * S;
    else if (fwd.z < -0.5) dWall = (b.maxZ + 4) * S - start.z;
    else if (fwd.x > 0.5) dWall = start.x - (b.minX - 4) * S;
    else if (fwd.x < -0.5) dWall = (b.maxX + 4) * S - start.x;
    const gatePos = start.clone().addScaledVector(fwd, -dWall);
    const stopPos = start.clone().addScaledVector(fwd, -(dWall + 7));

    if (type === 'parachute') {
      this.vehicle = makeVehicle('parachute');
      this.scene.add(this.vehicle);
      this.preludeChutes = this.comrades.map(() => {
        const c = makeVehicle('parachute');
        this.scene.add(c);
        return c;
      });
      // the jump plane thunders over the DZ while the sticks are in the air
      this.preludePlane = makeVehicle('plane');
      if (this.preludePlane) this.scene.add(this.preludePlane);
      this.prelude = { kind: 'drop', t: 0, dur: 6.2, start, yaw };
    } else {
      this.vehicle = makeVehicle(type);
      this.scene.add(this.vehicle);
      this.prelude = {
        kind: 'drive', t: 0,
        approach: 4.6, dismount: 2.0, fadeHold: 0.55,
        p0: stopPos.clone().addScaledVector(fwd, -46).addScaledVector(lat, 26),
        p1: stopPos.clone().addScaledVector(fwd, -20).addScaledVector(lat, 6),
        p2: stopPos, gatePos, start, fwd, lat, yaw,
        breachFired: false, fadeStarted: false,
        // baked vehicles carry their own seat layout; the fallback fits the
        // procedural humvee-scale hulls
        seats: (this.vehicle.userData.seats ?? [
          new THREE.Vector3(-0.45, 1.02, 0.55),
          new THREE.Vector3(0.5, 1.02, -0.6),
          new THREE.Vector3(-0.5, 1.02, -0.6)
        ]).map((s) => s.clone()),
        // crane shot: high 3/4 dolly, outside the walls
        craneFrom: stopPos.clone().addScaledVector(fwd, -32).addScaledVector(lat, 27).setY(16),
        craneTo: stopPos.clone().addScaledVector(fwd, -11).addScaledVector(lat, 15).setY(8.5),
        // gate shot: low angle beside the entrance
        gateCam: gatePos.clone().addScaledVector(fwd, -3.2).addScaledVector(lat, 8).setY(2.3),
        lookSmooth: null
      };
    }
    this.cb.onCinematicStart?.();
    sound.step();
  }

  lookToward(target, dt, speed = 3) {
    const m = new THREE.Matrix4().lookAt(this.camera.position, target, this.camera.up);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    this.camera.quaternion.slerp(q, Math.min(1, dt * speed));
  }

  finishPrelude() {
    const pr = this.prelude;
    if (this.viewmodelPrimary) this.viewmodelPrimary.visible = true;
    // authoritative reset: player and squad are PLACED at the spawn
    // formation (the fade hides this), so game state is always intact
    this.camera.position.set(pr.start.x, EYE, pr.start.z);
    this.camera.rotation.set(0, this.controls.yaw, 0, 'YXZ');
    this.player.pos.set(pr.start.x, EYE, pr.start.z);
    const fwd = new THREE.Vector3(-Math.sin(this.controls.yaw), 0, -Math.cos(this.controls.yaw));
    for (let i = 0; i < this.comrades.length; i++) {
      const colOffset = this.comradeSlots[i] - this.playerSlot;
      const slotPos = pr.start.clone().addScaledVector(fwd, -colOffset * COLUMN_SPACING).setY(0);
      this.comrades[i].setPosition(slotPos, this.controls.yaw + Math.PI);
      poseIdle(this.comrades[i].group, i);
    }
    if (this.preludeChutes) {
      for (const c of this.preludeChutes) this.scene.remove(c);
      this.preludeChutes = null;
    }
    if (this.preludePlane) {
      this.scene.remove(this.preludePlane);
      this.preludePlane = null;
    }
    if (pr.kind === 'drop' && this.vehicle) this.vehicle.visible = false;
    this.prelude = null;
    this.mode = 'play';
    this.round.segTime = 0;
    this.beginSegment(1, true);
    this.controls.enable();
    this.cb.onPreludeFade?.(false);
    this.cb.onDismount?.();
  }

  updatePrelude(dt) {
    const pr = this.prelude;
    if (!pr) return;
    pr.t += dt;
    const t = pr.t;
    const ease = (v) => THREE.MathUtils.clamp(v, 0, 1) ** 2 * (3 - 2 * THREE.MathUtils.clamp(v, 0, 1));

    if (pr.kind === 'drop') {
      // static-line jump: the squad floats down around you
      const e = ease(t / pr.dur);
      const alt = (1 - e) * 55;
      const sway = 1 - e;
      // the jump plane you just left, droning away ahead of the stick — it
      // sits below the falling camera's downward sightline so it actually
      // crosses the frame instead of passing unseen overhead
      if (this.preludePlane) {
        const fx = -Math.sin(pr.yaw), fz = -Math.cos(pr.yaw);
        const along = 6 + t * 42;
        this.preludePlane.position.set(
          pr.start.x + fx * along, 52, pr.start.z + fz * along
        );
        this.preludePlane.rotation.y = Math.atan2(fx, fz);
        this.preludePlane.visible = t < pr.dur * 0.75;
      }
      this.camera.position.set(
        pr.start.x + Math.sin(t * 1.3) * sway * 2.2,
        EYE + alt,
        pr.start.z + Math.cos(t * 1.1) * sway * 2.2
      );
      this.camera.rotation.set(-0.5 * sway, pr.yaw, Math.sin(t) * 0.06 * sway, 'YXZ');
      this.vehicle.position.copy(this.camera.position);
      this.vehicle.position.y -= 1.4;
      this.vehicle.rotation.y = pr.yaw;
      this.vehicle.visible = alt > 2;
      for (let i = 0; i < this.comrades.length; i++) {
        const ang = (i / 3) * Math.PI * 2 + 0.7;
        const cAlt = Math.max(0, alt + 4 + i * 2);
        const cx = pr.start.x + Math.cos(ang) * 4.5 + Math.sin(t * 1.1 + i) * sway;
        const cz = pr.start.z + Math.sin(ang) * 4.5 + Math.cos(t * 0.9 + i) * sway;
        this.comrades[i].setPosition(new THREE.Vector3(cx, cAlt, cz), pr.yaw + Math.PI);
        // seated-harness posture under canopy, upright for the landing
        if (cAlt > 3) poseSit(this.comrades[i].group, t * 3 + i);
        else poseIdle(this.comrades[i].group, t * 3 + i);
        const chute = this.preludeChutes[i];
        chute.position.set(cx, cAlt + 0.1, cz);
        chute.rotation.y = pr.yaw;
        chute.visible = cAlt > 1.5;
      }
      if (t >= pr.dur) this.finishPrelude();
      return;
    }

    // ---- drive-in cutscene: exterior camera work, fade-cut into FPS
    const tApp = pr.approach, tDis = tApp + pr.dismount, tEnd = tDis + pr.fadeHold;
    const bez = (u) => {
      const w = 1 - u;
      return new THREE.Vector3(
        w * w * pr.p0.x + 2 * u * w * pr.p1.x + u * u * pr.p2.x,
        0,
        w * w * pr.p0.z + 2 * u * w * pr.p1.z + u * u * pr.p2.z
      );
    };
    const smoothLook = (target, snap = false) => {
      if (!pr.lookSmooth || snap) pr.lookSmooth = target.clone();
      else pr.lookSmooth.lerp(target, Math.min(1, dt * 5));
      this.camera.lookAt(pr.lookSmooth);
    };

    if (t < tApp) {
      // SHOT 1 — crane wide: track the vehicle curving in toward the gate
      const u = ease(t / tApp);
      const pos = bez(u);
      const ahead = bez(Math.min(1, u + 0.02));
      tmpV.subVectors(ahead, pos);
      if (tmpV.lengthSq() > 1e-6) pr.vehYaw = Math.atan2(tmpV.x, tmpV.z);
      this.vehicle.position.copy(pos);
      this.vehicle.position.y = Math.abs(Math.sin(t * 6.5)) * 0.04 * (1 - u);
      this.vehicle.rotation.y = pr.vehYaw ?? pr.yaw;
      this.vehicle.updateMatrixWorld();

      // squad visibly riding along
      for (let i = 0; i < this.comrades.length; i++) {
        const world = this.vehicle.localToWorld(pr.seats[i].clone());
        const c = this.comrades[i];
        c.setPosition(world, (pr.vehYaw ?? pr.yaw) + (pr.seats[i].z > 0 ? Math.PI : 0));
        poseSit(c.group, t * 3 + i * 1.7);
      }

      this.camera.position.lerpVectors(pr.craneFrom, pr.craneTo, ease(t / tApp));
      smoothLook(this.vehicle.position.clone().setY(1.2), t < dt * 2);
    } else if (t < tDis) {
      // SHOT 2 — low angle at the gate: dismount, breach, run inside
      const tD = t - tApp;
      if (!pr.gateCut) {
        pr.gateCut = true;
        this.camera.position.copy(pr.gateCam);
        smoothLook(pr.gatePos.clone().addScaledVector(pr.fwd, -3).setY(1.2), true);
      }
      if (!pr.breachFired && tD > 0.9) {
        pr.breachFired = true;
        this.effects.explosion(pr.gatePos.clone().setY(1.1));
        sound.explosion();
        this.shake = 0.3;
      }
      for (let i = 0; i < this.comrades.length; i++) {
        const c = this.comrades[i];
        const k = ease((tD - i * 0.28) / 1.35);
        const seatWorld = this.vehicle.localToWorld(pr.seats[i].clone()).setY(0);
        const inside = pr.gatePos.clone()
          .addScaledVector(pr.fwd, 2.2)
          .addScaledVector(pr.lat, (i - 1) * 1.4);
        const pos = new THREE.Vector3().lerpVectors(seatWorld, inside, k);
        pos.y = 0;
        const faceYaw = Math.atan2(pr.gatePos.x - pos.x, pr.gatePos.z - pos.z);
        c.setPosition(pos, faceYaw);
        if (k > 0.02 && k < 0.98) animateWalk(c.group, t * 6.5, 1.1);
        else poseIdle(c.group, t * 3 + i);
      }
      smoothLook(pr.gatePos.clone().setY(1.2));
    } else if (t < tEnd) {
      // fade out, then the squad is PLACED at the spawn formation
      if (!pr.fadeStarted) {
        pr.fadeStarted = true;
        this.cb.onPreludeFade?.(true);
      }
    } else {
      this.finishPrelude();
    }
  }

  beginSegment(step, first = false) {
    const r = this.round;
    r.step = step;
    r.segTime = 0;
    r.segKills = 0;
    r.lethal = r.pendingBust;
    // fresh column order each leg — soldiers trade places on the move
    if (!first) {
      this.playerSlot = Math.floor(Math.random() * 3);
      const order = [0, 1, 2, 3].filter((s) => s !== this.playerSlot);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      this.comradeSlots = order;
    }
    this.setupObjective(step);
    this.spawnLockedGates(step);
    const segEnemies = this.enemies.filter((e) => e.seg === step && e.alive);
    r.segEnemyTotal = segEnemies.length;
    for (const e of segEnemies) e.engageDelay = 0.7 + Math.random() * 1.2;
    if (!first) sound.step();
    this.cb.onSegmentStart?.(step, r.lethal);
    this.cb.onObjective?.(this.objective);
  }

  // Sealed grey gates stand in this checkpoint's doorways from the moment
  // the segment starts — the "no passage yet" barrier is visible, not
  // invisible air. They light up into real route gates once the objective
  // is complete.
  spawnLockedGates(step) {
    this.clearLockedGates();
    if (step >= this.map.segments) return; // exfil room has no route gates
    const roomCell = this.map.rooms[step - 1];
    if (!roomCell?.exits) return;
    const S = this.map.cellSize;
    const roomPos = new THREE.Vector3(roomCell.x * S, 0, roomCell.z * S);
    this.lockedGates = [];
    this.lockedCells = new Set();
    for (const exit of roomCell.exits) {
      const gate = makeGate('Objective first', { risk: 'locked', width: 4.7 });
      gate.position.set(exit.cell.x * S, 0, exit.cell.z * S);
      gate.rotation.y = Math.atan2(roomPos.x - gate.position.x, roomPos.z - gate.position.z);
      this.scene.add(gate);
      this.lockedGates.push(gate);
      this.lockedCells.add(`${exit.cell.x},${exit.cell.z}`);
    }
  }

  clearLockedGates() {
    if (this.lockedGates) {
      for (const g of this.lockedGates) {
        this.scene.remove(g);
        g.traverse((o) => { o.material?.map?.dispose?.(); o.material?.dispose?.(); o.geometry?.dispose?.(); });
      }
    }
    this.lockedGates = null;
    this.lockedCells = null;
  }

  // ------------------------------------------------------- objectives

  segSiteInfo(step) {
    const S = this.map.cellSize;
    const cells = this.map.path.filter((p) =>
      p.seg === step &&
      !this.map.rooms.some((rm) => Math.abs(rm.x - p.x) <= 1 && Math.abs(rm.z - p.z) <= 1));
    if (cells.length < 2) return null;
    const idx = Math.min(cells.length - 2, Math.floor(cells.length * 0.6));
    const cell = cells[idx];
    const nxt = cells[idx + 1] ?? cell;
    const yaw = Math.atan2(nxt.x - cell.x, nxt.z - cell.z);
    return {
      pos: new THREE.Vector3(cell.x * S, 0, cell.z * S),
      yaw,
      fwd: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)),
      lat: new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
    };
  }

  spawnGuards(step, pos, offsets) {
    for (const [dx, dz] of offsets) {
      this.enemies.push(new EnemyBot(
        this.scene, new THREE.Vector3(pos.x + dx, 0, pos.z + dz), null, step,
        { weapon: this.enemyWeapon() }));
    }
  }

  setupObjective(step) {
    const spec = this.mission.objectives?.[step - 1] ?? { mech: 'sweep', title: 'Clear the route', prop: null };
    const o = this.objective = {
      mech: spec.mech, title: spec.title, prop: spec.prop,
      done: false, progress: 0, detectT: 0, compromised: false, seen: false,
      holdT: 0, holdNeeded: 11, wavesSpawned: 0, stallT: 0, hintT: 0,
      timer: null, overdue: false, sitePos: null, hvtId: null,
      destructible: null, beacon: null
    };
    const site = this.segSiteInfo(step);
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

    switch (o.mech) {
      case 'stealth': {
        for (const e of this.enemies) {
          if (e.seg === step && e.alive) e.stealthMode = true;
        }
        break;
      }
      case 'destroy': {
        if (!site) break;
        const kind = o.prop ?? 'cache';
        const prop = kind === 'car' ? makeCar({ pick }) : makeObjectiveProp(kind);
        prop.position.copy(site.pos);
        prop.rotation.y = site.yaw + (Math.random() - 0.5) * 0.8;
        this.scene.add(prop);
        const d = { kind, group: prop, hp: 7, alive: true, pos: site.pos.clone() };
        prop.userData.destructibleRef = d;
        this.destructibles.push(d);
        o.destructible = d;
        this.spawnGuards(step, site.pos, [[2.2, 1.6], [-2.0, -1.4]]);
        break;
      }
      case 'hvt': {
        // promote a mid-segment enemy (or spawn one) into the marked target
        let hvt = this.enemies.find((e) => e.seg === step && e.alive && !e.elevated);
        if (!hvt && site) {
          hvt = new EnemyBot(this.scene, site.pos.clone(), null, step);
          this.enemies.push(hvt);
        }
        if (hvt) {
          hvt.isHVT = true;
          hvt.hp = 3;
          const band = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.1, 0.34),
            new THREE.MeshBasicMaterial({ color: 0xff4a3a })
          );
          band.position.y = 1.02;
          hvt.group.add(band);
          o.hvtId = hvt.id;
        }
        break;
      }
      case 'interact': {
        if (!site) break;
        const prop = makeObjectiveProp(o.prop === 'charge' ? 'charge' : 'console');
        prop.position.copy(site.pos);
        prop.rotation.y = site.yaw + Math.PI;
        this.scene.add(prop);
        // charges leave something to blow once planted
        if (o.prop === 'charge') {
          const d = { kind: 'charge', group: prop, hp: 99, alive: true, pos: site.pos.clone() };
          prop.userData.destructibleRef = d;
          this.destructibles.push(d);
          o.destructible = d;
        } else {
          o.consoleProp = prop;
        }
        const beacon = new THREE.Mesh(
          new THREE.RingGeometry(1.6, 1.95, 24),
          new THREE.MeshBasicMaterial({ color: 0x7dffa0, side: THREE.DoubleSide, transparent: true, opacity: 0.55 })
        );
        beacon.rotation.x = -Math.PI / 2;
        beacon.position.copy(site.pos).setY(0.06);
        this.scene.add(beacon);
        o.beacon = beacon;
        o.sitePos = site.pos.clone();
        this.spawnGuards(step, site.pos, [[2.4, -1.6], [-2.2, 1.8]]);
        break;
      }
      case 'hold': {
        // the checkpoint room is the hold zone; stage cover + attack waves
        const room = this.currentRoomCenterFor(step);
        if (room) {
          const grp = new THREE.Group();
          const mat = new THREE.MeshLambertMaterial({ color: 0x6e5c3a });
          for (const [dx, dz] of [[-2.2, 0], [2.2, 0], [0, -2.2]]) {
            const crate = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.05, 0.85), mat);
            crate.position.set(room.x + dx, 0.53, room.z + dz);
            crate.rotation.y = Math.atan2(dx, dz);
            grp.add(crate);
          }
          this.scene.add(grp);
          const d = { kind: 'post', group: grp, hp: 8, alive: true, pos: room.clone() };
          grp.userData.destructibleRef = d;
          this.destructibles.push(d);
        }
        break;
      }
      case 'timed': {
        const segLen = this.map.path.filter((p) => p.seg === step).length;
        o.timer = segLen * this.map.cellSize / 3.2 + 15;
        break;
      }
      case 'escort': {
        if (!site) break;
        const civ = new Comrade(this.scene, this.mission.team.camo, { callsign: 'Asset' },
          makeCivilian([0x7a5a6a, 0x5a6a7a, 0x7a6a4a][step % 3]));
        civ.setPosition(site.pos.clone(), site.yaw);
        this.npc = civ;
        this.npcActive = false;
        o.sitePos = site.pos.clone();
        break;
      }
    }
  }

  currentRoomCenterFor(step) {
    const room = this.map.rooms[step - 1];
    if (!room) return null;
    const S = this.map.cellSize;
    return new THREE.Vector3(room.x * S, 0, room.z * S);
  }

  compromiseStealth() {
    const o = this.objective;
    if (!o || o.compromised) return;
    o.compromised = true;
    for (const e of this.enemies) {
      if (e.seg === this.round.step && e.alive) {
        e.stealthMode = false;
        e.engage();
      }
    }
    sound.alarm();
    this.cb.onCompromised?.();
  }

  autoResolveObjective() {
    const o = this.objective;
    if (!o || o.done) return;
    switch (o.mech) {
      case 'sweep': {
        for (const e of this.enemies) {
          if (e.seg === this.round.step && e.alive) {
            e.takeHit(this.effects);
            e.takeHit(this.effects);
            if (!e.alive) this.registerKill(e, 'comrade');
          }
        }
        break;
      }
      case 'destroy': {
        if (o.destructible?.alive) this.destroyDestructible(o.destructible, 'comrade');
        break;
      }
      case 'hvt': {
        const hvt = this.enemies.find((e) => e.id === o.hvtId);
        if (hvt?.alive) {
          hvt.takeHit(this.effects);
          hvt.takeHit(this.effects);
          hvt.takeHit(this.effects);
          if (!hvt.alive) this.registerKill(hvt, 'comrade');
        }
        break;
      }
      case 'interact': {
        o.progress = 1;
        this.completeInteract();
        break;
      }
    }
    this.cb.onSquadResolve?.(o.mech);
  }

  completeInteract() {
    const o = this.objective;
    if (o.done) return;
    o.done = true;
    if (o.beacon) o.beacon.material.color.set(0x4a9aff);
    if (o.prop === 'charge' && o.destructible?.alive) {
      // the planted charge cooks off after a beat
      setTimeout(() => {
        if (o.destructible.alive) this.destroyDestructible(o.destructible, 'player');
      }, 900);
    }
    sound.cash();
  }

  currentRoomCenter() {
    const room = this.map.rooms[this.round.step - 1];
    if (!room) return null;
    const S = this.map.cellSize;
    return new THREE.Vector3(room.x * S, 0, room.z * S);
  }

  // ------------------------------------------------------ line of sight
  //
  // Fast grid march (Amanatides & Woo) through the map cells. A shot is
  // blocked when it crosses an uncarved cell BELOW that cell's blocking
  // height — full walls block standing shots, courtyard cover only blocks
  // crouch-height shots, and anything flying high (tower snipers) clears.

  gridCast(from, to) {
    const S = this.map.cellSize;
    const fx = from.x / S + 0.5, fz = from.z / S + 0.5;
    const tx = to.x / S + 0.5, tz = to.z / S + 0.5;
    const dx = tx - fx, dz = tz - fz;
    let cx = Math.floor(fx), cz = Math.floor(fz);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = dx !== 0 ? (stepX > 0 ? cx + 1 - fx : fx - cx) * tDeltaX : Infinity;
    let tMaxZ = dz !== 0 ? (stepZ > 0 ? cz + 1 - fz : fz - cz) * tDeltaZ : Infinity;
    let t = 0;
    for (let i = 0; i < 160; i++) {
      if (tMaxX < tMaxZ) { cx += stepX; t = tMaxX; tMaxX += tDeltaX; }
      else { cz += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; }
      if (t > 1) return null;
      if (!this.map.isCarved(cx, cz)) {
        const cutoff = this.pillarSet.has(`${cx},${cz}`) ? 1.45 : 3.45;
        const h = from.y + (to.y - from.y) * t;
        if (h < cutoff) {
          return { t, point: new THREE.Vector3().lerpVectors(from, to, t) };
        }
      }
    }
    return null;
  }

  losClear(from, to) { return this.gridCast(from, to) === null; }
  clipPoint(from, to) { return this.gridCast(from, to)?.point ?? to; }

  // Gentle positional relaxation between soldier bodies: overlapping pairs
  // slide apart a little each frame instead of sharing space. Purely
  // corrective (no velocities), so it converges without jitter. The player
  // acts as an immovable body so nobody crowds the camera.
  separateBots() {
    const bodies = [];
    for (const c of this.comrades) bodies.push({ p: c.group.position, s: c.smooth });
    if (this.npc) bodies.push({ p: this.npc.group.position, s: this.npc.smooth });
    for (const e of this.enemies) {
      if (e.alive && !e.elevated) bodies.push({ p: e.group.position });
    }
    const walk = this.botCtxExtras().isWalkable;
    const R = 0.62; // body diameter-ish
    const apply = (b, dx, dz) => {
      const nx = b.p.x + dx, nz = b.p.z + dz;
      if (!walk(nx, nz, 0.3)) return;
      b.p.x = nx; b.p.z = nz;
      if (b.s) { b.s.x = nx; b.s.z = nz; }
    };
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i].p, b = bodies[j].p;
        let dx = b.x - a.x, dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= R * R || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (R - d) * 0.2;
        dx /= d; dz /= d;
        apply(bodies[i], -dx * push, -dz * push);
        apply(bodies[j], dx * push, dz * push);
      }
      // keep clear of the commander
      const a = bodies[i].p;
      let dx = a.x - this.player.pos.x, dz = a.z - this.player.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < R * R && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        apply(bodies[i], (dx / d) * (R - d) * 0.3, (dz / d) * (R - d) * 0.3);
      }
    }
  }

  // ~1 in 5 of the garrison fields the theatre's specialist weapon (the
  // same one this map's squad carries as a backup) instead of a rifle
  enemyWeapon(chance = 0.2) {
    const backup = this.mission?.team?.backup;
    const name = { harpoon: 'harpoon', knife: 'knife', flashgl: 'flashgl', shotgun: 'shotgun', rpg: 'rpg' }[backup];
    return name && Math.random() < chance ? name : 'rifle';
  }

  botCtxExtras() {
    return {
      los: (a, b) => this.losClear(a, b),
      clip: (a, b) => this.clipPoint(a, b),
      // radius-aware so bot bodies can't overlap walls half-way
      isWalkable: (x, z, r = 0.4) => {
        const ok = (px, pz) => {
          const c = this.map.cellAt(px, pz);
          return this.map.isCarved(c.x, c.z);
        };
        return ok(x, z) && ok(x + r, z) && ok(x - r, z) && ok(x, z + r) && ok(x, z - r);
      }
    };
  }

  destroyDestructible(d, by = 'player') {
    if (!d.alive) return;
    d.alive = false;
    const blast = d.pos.clone().setY(0.8);
    this.effects.explosion(blast);
    sound.explosion();
    this.shake = Math.min(this.shake + 0.6, 1);
    if (d.kind === 'post') {
      // barricade breaks apart
      d.group.traverse((o) => { if (o.isMesh) { o.scale.y = 0.3; o.position.y = 0.16; } });
    } else {
      // vehicles / objective targets cook off, taking out anyone beside them
      d.group.userData.wreck?.();
      for (const e of this.enemies) {
        if (e.alive && e.group.position.distanceTo(blast) < 6.5 &&
            this.losClear(blast, e.group.position.clone().setY(1.2))) {
          e.takeHit(this.effects, 'explosion', blast);
          e.takeHit(this.effects, 'explosion', blast);
          if (!e.alive) this.registerKill(e, by);
        }
      }
    }
  }

  // cash out — only available while standing at a checkpoint's route gates
  cashOut() {
    if (!this.gatePhase || this.round.over) return 0;
    const r = this.round;
    // below-stake rungs cannot be cashed — the UI disables the button too
    if (r.curRung < 1) return 0;
    r.over = true;
    const payout = r.bet * r.curRung;
    for (const g of this.gatePhase.gates) this.scene.remove(g);
    this.gatePhase = null;
    this.mode = 'extract';
    this.controls.disable();
    if (document.pointerLockElement) document.exitPointerLock?.();
    sound.cash();
    this.cb.onRoundEnd?.({ result: 'cashout', payout, step: r.step, kills: r.kills });
    return payout;
  }

  // ------------------------------------------------------------- combat

  tryFire(dt) {
    const p = this.player;
    p.fireTimer -= dt;

    if (this.weaponMode === 'backup') {
      if (!this.controls.firing || p.fireTimer > 0) return;
      const spec = BACKUPS[this.mission.team.backup];
      p.fireTimer = spec.interval;
      if (this.backupAmmo <= 0) {
        this.switchWeapon(); // dry — back to the rifle
        return;
      }
      this.backupAmmo--;
      this.cb.onAmmo?.(this.backupAmmo, false);
      this.fireBackup(this.mission.team.backup);
      return;
    }

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
    if (this.viewmodel) this.viewmodel.position.z = (this.vmBase?.z ?? -0.5) + 0.1; // kick, eased back in update
    this.vmFireT = 0.18; // hold the firing pose on the rigged arms

    // raycast from camera center; the round stops at the FIRST thing it
    // meets — wall, destructible, or enemy
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: 0, y: 0 }, this.camera);
    ray.far = 90;

    const camPos = new THREE.Vector3();
    this.camera.getWorldPosition(camPos);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);

    const enemyHits = ray.intersectObjects(this.enemies.filter((e) => e.alive).map((e) => e.group), true);
    const destrHits = ray.intersectObjects(this.destructibles.filter((d) => d.alive).map((d) => d.group), true);
    const wallHit = this.gridCast(camPos, camPos.clone().addScaledVector(dir, 90));
    const wallDist = wallHit ? wallHit.t * 90 : Infinity;
    const enemyDist = enemyHits.length > 0 ? enemyHits[0].distance : Infinity;
    const destrDist = destrHits.length > 0 ? destrHits[0].distance : Infinity;

    // rounds leave the actual barrel tip of the viewmodel (centered on the
    // camera when scoped, offset to the right hand when hip-firing)
    this.camera.updateMatrixWorld();
    const muzzle = this.camera.localToWorld(
      this.controls.scoped ? tmpV.set(0.0, -0.07, -0.95) : tmpV.set(0.24, -0.15, -1.0)
    ).clone();

    let end;
    if (enemyDist < wallDist && enemyDist <= destrDist) {
      end = enemyHits[0].point;
      const bot = enemyHits[0].object.userData.soldierRoot?.userData.enemyId;
      const enemy = this.enemies.find((e) => e.id === bot);
      if (enemy) {
        enemy.engage();
        const died = enemy.takeHit(this.effects);
        sound.hit();
        if (died) this.registerKill(enemy, 'player');
      }
    } else if (destrDist < wallDist) {
      end = destrHits[0].point;
      let node = destrHits[0].object;
      while (node && !node.userData.destructibleRef) node = node.parent;
      const d = node?.userData.destructibleRef;
      this.effects.impact(end);
      if (d && d.alive) {
        d.hp -= 1;
        if (d.hp <= 0) this.destroyDestructible(d, 'player');
      }
    } else if (wallHit) {
      end = wallHit.point;
      this.effects.impact(end);
    } else {
      end = muzzle.clone().addScaledVector(dir, 90);
    }
    this.effects.tracer(muzzle, end, true);
    this.effects.muzzleFlash(muzzle, dir);
  }

  fireBackup(kind) {
    this.camera.updateMatrixWorld();
    const camPos = new THREE.Vector3();
    this.camera.getWorldPosition(camPos);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const muzzle = this.camera.localToWorld(
      this.controls.scoped ? tmpV.set(0, -0.07, -0.95) : tmpV.set(0.24, -0.15, -1.0)
    ).clone();
    this.shake = Math.min(this.shake + (kind === 'rpg' ? 0.35 : 0.18), 0.7);
    if (this.viewmodel) this.viewmodel.position.z = kind === 'rpg' ? -0.3 : -0.38;
    // drive the firing pose on the rigged arms (the knife's throw gesture
    // hangs off this too — without it the viewmodel never animated a shot)
    this.vmFireT = 0.22;
    this.effects.muzzleFlash(muzzle, dir);

    if (kind === 'shotgun') {
      sound.burst({ dur: 0.16, freq: 520, gain: 0.42 });
      const right = new THREE.Vector3().crossVectors(dir, this.camera.up).normalize();
      const up = new THREE.Vector3().crossVectors(right, dir).normalize();
      for (let i = 0; i < 7; i++) {
        const d = dir.clone()
          .addScaledVector(right, (Math.random() - 0.5) * 0.13)
          .addScaledVector(up, (Math.random() - 0.5) * 0.09)
          .normalize();
        const ray = new THREE.Raycaster(camPos.clone(), d, 0.1, 45);
        const enemyHits = ray.intersectObjects(this.enemies.filter((e) => e.alive).map((e) => e.group), true);
        const destrHits = ray.intersectObjects(this.destructibles.filter((dd) => dd.alive).map((dd) => dd.group), true);
        const wallHit = this.gridCast(camPos, camPos.clone().addScaledVector(d, 45));
        const wallDist = wallHit ? wallHit.t * 45 : Infinity;
        const eDist = enemyHits.length ? enemyHits[0].distance : Infinity;
        const dDist = destrHits.length ? destrHits[0].distance : Infinity;
        let end;
        if (eDist < wallDist && eDist <= dDist) {
          end = enemyHits[0].point;
          const id = enemyHits[0].object.userData.soldierRoot?.userData.enemyId;
          const enemy = this.enemies.find((e) => e.id === id);
          if (enemy) {
            enemy.engage();
            const died = enemy.takeHit(this.effects);
            if (died) this.registerKill(enemy, 'player');
          }
        } else if (dDist < wallDist) {
          end = destrHits[0].point;
          let node = destrHits[0].object;
          while (node && !node.userData.destructibleRef) node = node.parent;
          const dd = node?.userData.destructibleRef;
          if (dd?.alive && (dd.hp -= 1) <= 0) this.destroyDestructible(dd, 'player');
          this.effects.impact(end);
        } else if (wallHit) {
          end = wallHit.point;
          this.effects.impact(end);
        } else {
          end = camPos.clone().addScaledVector(d, 45);
        }
        this.effects.tracer(muzzle, end, true);
      }
      return;
    }

    // projectile weapons
    let mesh, vel, grav = 0;
    if (kind === 'harpoon') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.8, 6), new THREE.MeshLambertMaterial({ color: 0x9aa4ac }));
      mesh.rotation.x = Math.PI / 2;
      vel = dir.clone().multiplyScalar(46);
      grav = 2.5;
      sound.burst({ dur: 0.1, freq: 900, gain: 0.25 });
    } else if (kind === 'knife') {
      // the round in flight IS the carried blade, at the same size
      mesh = makeThrownWeapon('knife')
        ?? new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.09, 0.68), new THREE.MeshLambertMaterial({ color: 0xaeb8be }));
      vel = dir.clone().multiplyScalar(30);
      grav = 7;
      sound.tone({ dur: 0.08, from: 1200, to: 700, gain: 0.09 });
    } else if (kind === 'flashgl') {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshLambertMaterial({ color: 0xc8cdd2 }));
      vel = dir.clone().multiplyScalar(17).add(new THREE.Vector3(0, 2.5, 0));
      grav = 18;
      sound.tone({ dur: 0.12, from: 300, to: 150, gain: 0.2, type: 'square' });
    } else { // rpg
      mesh = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.45, 8), new THREE.MeshLambertMaterial({ color: 0x3a4034 }));
      body.rotation.x = Math.PI / 2;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.22, 8), new THREE.MeshLambertMaterial({ color: 0x4a5a3a }));
      tip.rotation.x = -Math.PI / 2;
      tip.position.z = -0.3;
      mesh.add(body, tip);
      vel = dir.clone().multiplyScalar(28);
      grav = 1;
      sound.burst({ dur: 0.3, freq: 300, gain: 0.35 });
    }
    mesh.position.copy(muzzle);
    this.scene.add(mesh);
    this.projectiles.push({ kind, mesh, vel, grav, life: 0, stuck: false, smokeT: 0 });
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.life += dt;
      if (pr.stuck) {
        if (pr.life > 3) { this.scene.remove(pr.mesh); this.projectiles.splice(i, 1); }
        continue;
      }
      if (pr.life > 5) { this.scene.remove(pr.mesh); this.projectiles.splice(i, 1); continue; }

      const prev = pr.mesh.position.clone();
      pr.vel.y -= pr.grav * dt;
      pr.mesh.position.addScaledVector(pr.vel, dt);
      if (pr.kind === 'knife') {
        pr.mesh.rotation.x += dt * 14;
      } else {
        pr.mesh.lookAt(tmpV.copy(pr.mesh.position).add(pr.vel));
        if (pr.kind === 'harpoon') pr.mesh.rotateX(Math.PI / 2);
      }
      if (pr.kind === 'rpg') {
        pr.smokeT -= dt;
        if (pr.smokeT <= 0) {
          pr.smokeT = 0.035;
          this.effects.smokePuff(prev);
        }
      }

      // impacts: enemy > destructible > wall > ground
      let impact = null;
      let hitEnemy = null, hitDestr = null;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (tmpV.copy(e.group.position).setY(e.group.position.y + 1.1).distanceTo(pr.mesh.position) < 1.0) {
          hitEnemy = e;
          impact = pr.mesh.position.clone();
          break;
        }
      }
      if (!impact) {
        for (const dd of this.destructibles) {
          if (dd.alive && dd.pos.distanceTo(pr.mesh.position) < 1.8) {
            hitDestr = dd;
            impact = pr.mesh.position.clone();
            break;
          }
        }
      }
      if (!impact) {
        const wallHit = this.gridCast(prev, pr.mesh.position);
        if (wallHit) impact = wallHit.point;
        else if (pr.mesh.position.y <= 0.05) impact = pr.mesh.position.clone().setY(0.05);
      }
      if (!impact) continue;

      if (pr.kind === 'flashgl') {
        this.effects.flashBang(impact);
        sound.explosion();
        for (const e of this.enemies) {
          if (e.alive && e.group.position.distanceTo(impact) < 9.5 &&
              this.losClear(impact.clone().setY(1), e.group.position.clone().setY(1.2))) {
            e.stunT = 4;
            e.engage();
          }
        }
        if (this.objective?.mech === 'stealth' && !this.objective.compromised) this.compromiseStealth();
      } else if (pr.kind === 'rpg') {
        this.effects.explosion(impact);
        sound.explosion();
        this.shake = 0.8;
        for (const e of this.enemies) {
          if (e.alive && e.group.position.distanceTo(impact) < 5.5 &&
              this.losClear(impact.clone().setY(0.8), e.group.position.clone().setY(1.2))) {
            e.takeHit(this.effects, 'explosion', impact);
            const died = e.takeHit(this.effects, 'explosion', impact);
            if (died || !e.alive) this.registerKill(e, 'player');
          }
        }
        for (const dd of this.destructibles) {
          if (dd.alive && dd.pos.distanceTo(impact) < 5) this.destroyDestructible(dd, 'player');
        }
        if (this.objective?.mech === 'stealth' && !this.objective.compromised) this.compromiseStealth();
      } else {
        // harpoon / knife: lethal single hit, then the round sticks
        if (hitEnemy) {
          hitEnemy.engage();
          hitEnemy.takeHit(this.effects);
          const died = hitEnemy.takeHit(this.effects);
          if (died || !hitEnemy.alive) this.registerKill(hitEnemy, 'player');
          sound.hit();
        } else if (hitDestr) {
          hitDestr.hp -= 2;
          this.effects.hitSpark(impact);
          if (hitDestr.hp <= 0) this.destroyDestructible(hitDestr, 'player');
        }
        pr.mesh.position.copy(impact);
        pr.stuck = true;
        pr.life = 0;
        continue;
      }
      this.scene.remove(pr.mesh);
      this.projectiles.splice(i, 1);
    }
  }

  throwFrag() {
    if (this.mode !== 'play') return;
    const p = this.player;
    if (p.fragTimer > 0) return;
    p.fragTimer = FRAG_COOLDOWN;
    this.throwAnimT = 0.55; // rifle tucks aside while the off-hand throws
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
        // explosions are loud — a stealth segment goes loud with them
        if (this.objective?.mech === 'stealth' && !this.objective.compromised) {
          this.compromiseStealth();
        }
        const blast = g.mesh.position.clone().setY(0.6);
        for (const e of this.enemies) {
          if (e.alive && e.group.position.distanceTo(g.mesh.position) < 5.5 &&
              this.losClear(blast, e.group.position.clone().setY(1.2))) {
            e.takeHit(this.effects, 'explosion', g.mesh.position);
            const died = e.takeHit(this.effects, 'explosion', g.mesh.position);
            if (died || !e.alive) this.registerKill(e, 'player');
          }
        }
        for (const d of this.destructibles) {
          if (d.alive && d.pos.distanceTo(g.mesh.position) < 5 &&
              this.losClear(blast, d.pos.clone().setY(0.8))) {
            this.destroyDestructible(d, 'player');
          }
        }
        this.scene.remove(g.mesh);
        this.grenades.splice(i, 1);
      }
    }
  }

  registerKill(enemy, by) {
    this.lastKillEvent = {
      x: enemy.group.position.x,
      z: enemy.group.position.z,
      t: performance.now()
    };
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
    // (touch look is applied directly by swipe-drag in controls)
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

    // acceleration smoothing: momentum makes footwork feel weighty
    if (!this.player.vel) this.player.vel = new THREE.Vector3();
    const vel = this.player.vel;
    wish.multiplyScalar(speed);
    vel.lerp(wish, Math.min(1, dt * 11));

    const p = this.player.pos;
    const step = tmpV.copy(vel).multiplyScalar(dt);
    // axis-separated collision against uncarved cells
    const S = this.map.cellSize;
    const solidAt = (px, pz) => {
      const cell = this.map.cellAt(px, pz);
      const ck = `${cell.x},${cell.z}`;
      if (!this.map.isCarved(cell.x, cell.z)) {
        // courtyard cover blocks only its visible footprint, not the cell
        if (this.pillarSet.has(ck)) {
          return Math.abs(px - cell.x * S) < 2.0 && Math.abs(pz - cell.z * S) < 2.0;
        }
        return true;
      }
      // sealed doorway gates physically hold the line until the objective
      // is done (the grey gates make this barrier visible)
      if (this.lockedCells && !this.gatePhase && this.lockedCells.has(ck)) return true;
      // backstop: the next segment stays sealed until a route is chosen
      const segOf = this.map.segOfCell(cell.x, cell.z);
      if (segOf !== undefined && this.round && segOf > this.round.step) return true;
      return false;
    };
    const tryAxis = (dx, dz) => {
      const nx = p.x + dx, nz = p.z + dz;
      const rd = PLAYER_RADIUS * 0.71; // diagonal probes catch wall corners
      const pts = [
        [nx + PLAYER_RADIUS, nz], [nx - PLAYER_RADIUS, nz],
        [nx, nz + PLAYER_RADIUS], [nx, nz - PLAYER_RADIUS],
        [nx + rd, nz + rd], [nx - rd, nz + rd],
        [nx + rd, nz - rd], [nx - rd, nz - rd]
      ];
      for (const [px, pz] of pts) {
        if (solidAt(px, pz)) return false;
      }
      p.x = nx; p.z = nz;
      return true;
    };
    if (!tryAxis(step.x, 0)) vel.x = 0;
    if (!tryAxis(0, step.z)) vel.z = 0;

    // breadcrumb trail for the trailing column
    if (this.trail) {
      const last = this.trail[this.trail.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.z - last.z) > 0.6) {
        this.trail.push(new THREE.Vector3(p.x, 0, p.z));
        if (this.trail.length > 400) this.trail.shift();
      }
    }

    // view bob
    const moving = len > 0.05;
    this.player.bob += dt * (moving ? 9 : 2);
    const bobAmp = moving && !c.scoped ? 0.045 : 0.008;

    // subtle strafe roll sells the momentum
    const targetRoll = -c.move.x * 0.014;
    if (this.camRoll === undefined) this.camRoll = 0;
    this.camRoll += (targetRoll - this.camRoll) * Math.min(1, dt * 8);

    this.camera.position.set(p.x, EYE + Math.sin(this.player.bob) * bobAmp, p.z);
    this.camera.rotation.set(c.pitch, c.yaw, this.camRoll, 'YXZ');
  }

  // ------------------------------------------------------------- pot / flow

  updatePlayFlow(dt) {
    const r = this.round;
    const o = this.objective;
    r.segTime += dt;

    // engage current-segment enemies (stealth patrols hold until compromised)
    const playerPos = this.player.pos;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.seg === r.step) {
        e.engageDelay -= dt;
        if (e.engageDelay <= 0 && !e.stealthMode) e.engage();
        e.engagedFor = (e.engagedFor ?? 0) + (e.state === 'combat' ? dt : 0);
      } else if (e.seg === r.step + 1 && !e.stealthMode &&
                 e.group.position.distanceTo(playerPos) < this.map.cellSize * 1.6) {
        // early birds near the room edge open up too
        e.engage();
      }
    }

    // ------------------- objective mechanics
    const segAlive = this.enemies.filter((e) => e.seg === r.step && e.alive);
    let objFrac = 0;
    let detail = '';
    let warn = false;
    switch (o?.mech) {
      case 'sweep': {
        o.done = segAlive.length === 0;
        objFrac = r.segEnemyTotal > 0 ? 1 - segAlive.length / r.segEnemyTotal : 1;
        detail = o.done ? 'AREA CLEAR' : `${segAlive.length} HOSTILE${segAlive.length === 1 ? '' : 'S'} LEFT`;
        break;
      }
      case 'stealth': {
        o.done = true; // completes on reaching the checkpoint
        if (!o.compromised) {
          let watchers = 0;
          for (const e of segAlive) {
            if (e.elevated) continue;
            tmpV.subVectors(playerPos, e.group.position);
            const dist = tmpV.length();
            if (dist > 17) continue;
            tmpV.normalize();
            const fx = Math.sin(e.group.rotation.y), fz = Math.cos(e.group.rotation.y);
            if (tmpV.x * fx + tmpV.z * fz < 0.45) continue;
            tmpV2.set(e.group.position.x, e.group.position.y + 1.5, e.group.position.z);
            if (this.losClear(tmpV2, playerPos)) watchers++;
          }
          if (watchers > 0) o.detectT += dt * watchers;
          else o.detectT = Math.max(0, o.detectT - dt * 0.8);
          o.seen = watchers > 0;
          if (o.detectT > 0.9 || (r.lethal && r.segTime > 2.5)) this.compromiseStealth();
          detail = o.seen ? 'BEING SPOTTED' : 'UNDETECTED';
          warn = o.seen;
        } else {
          detail = 'COMPROMISED — WEAPONS FREE';
          warn = true;
        }
        objFrac = 0;
        break;
      }
      case 'destroy': {
        o.done = o.destructible ? !o.destructible.alive : true;
        objFrac = o.done ? 1 : 0;
        detail = o.done ? 'TARGET DESTROYED' : 'TARGET ACTIVE — LIGHT IT UP';
        break;
      }
      case 'hvt': {
        const hvt = this.enemies.find((e) => e.id === o.hvtId);
        o.done = !hvt || !hvt.alive;
        objFrac = o.done ? 1 : 0;
        detail = o.done ? 'TARGET DOWN' : 'TARGET MARKED — TAKE THE SHOT';
        break;
      }
      case 'interact': {
        if (!o.done && o.sitePos) {
          const near = Math.hypot(o.sitePos.x - playerPos.x, o.sitePos.z - playerPos.z) < 2.6;
          if (near) {
            o.progress = Math.min(1, o.progress + dt / 3.4);
            if (o.progress >= 1) this.completeInteract();
          }
          detail = near ? `WORKING — ${Math.round(o.progress * 100)}%`
            : o.progress > 0 ? `PAUSED AT ${Math.round(o.progress * 100)}% — GET BACK ON IT`
              : 'GET TO THE DEVICE';
        } else {
          detail = 'OBJECTIVE SECURED';
        }
        objFrac = o.progress;
        break;
      }
      case 'hold': {
        const room = this.currentRoomCenterFor(r.step);
        if (room && !o.done) {
          const roomCell = this.map.rooms[r.step - 1];
          const pcHold = this.map.cellAt(playerPos.x, playerPos.z);
          const inZone = Math.abs(pcHold.x - roomCell.x) <= 1 && Math.abs(pcHold.z - roomCell.z) <= 1;
          if (inZone) {
            o.holdT += dt;
            // attack waves crash the hold
            const waveTimes = [1.5, 6.5];
            if (o.wavesSpawned < waveTimes.length && o.holdT > waveTimes[o.wavesSpawned]) {
              this.spawnHoldWave(r.step, room);
              o.wavesSpawned++;
            }
            detail = `HOLD THE POSITION — ${Math.ceil(o.holdNeeded - o.holdT)}s`;
            warn = true;
          } else {
            detail = 'GET TO THE HOLD POINT';
          }
          if (o.holdT >= o.holdNeeded) o.done = true;
        } else {
          detail = 'POSITION HELD';
        }
        objFrac = Math.min(1, o.holdT / o.holdNeeded);
        break;
      }
      case 'timed': {
        o.done = true;
        if (o.timer !== null && !o.overdue) {
          o.timer -= dt;
          if (o.timer <= 0) {
            o.overdue = true;
            this.cb.onOverdue?.();
          }
        }
        const t = Math.max(0, o.timer ?? 0);
        detail = o.overdue ? 'OVERDUE — SQUAD COVERING, MOVE!' : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
        warn = o.overdue || t < 12;
        objFrac = 0;
        break;
      }
      case 'escort': {
        o.done = true;
        if (this.npc && !this.npcActive) {
          if (this.npc.group.position.distanceTo(playerPos) < 8) {
            this.npcActive = true;
            this.cb.onAssetPickup?.();
          }
          detail = 'REACH THE ASSET';
        } else {
          detail = 'ASSET IN TOW — MOVE TO THE CHECKPOINT';
        }
        objFrac = this.npcActive ? 0.6 : 0;
        break;
      }
      default:
        o && (o.done = true);
    }
    if (o) this.cb.onObjectiveTick?.(detail, warn);

    // pot presentation: creep toward the next rung with objective + travel
    // progress (starts from 0 — nothing is secured until checkpoint 1)
    const prevMult = r.curRung;
    const nextMult = r.rungTarget;
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
    const frac = THREE.MathUtils.clamp(distFrac * 0.45 + objFrac * 0.55, 0, 0.98);
    const targetPot = r.bet * (prevMult + (nextMult - prevMult) * frac);
    r.pot += (targetPot - r.pot) * Math.min(1, dt * 3);
    this.cb.onPot?.(r.pot, nextMult * r.bet);

    // health regen outside the bust step
    if (!r.lethal && this.player.health < 100) {
      this.player.health = Math.min(100, this.player.health + dt * 20);
      this.cb.onHealth?.(this.player.health);
    }

    // bust-step pressure: every death must come from a visible soldier and
    // his gunfire — never sourceless chip damage. If the hunt stalls, feed
    // in reinforcements that enter the scene naturally (spawned out of the
    // player's sight, charging in); late waves come in behind the player so
    // there is nowhere left to camp.
    if (r.lethal) {
      r.bustPressureT = (r.bustPressureT ?? 0) + dt;
      if (r.segTime > 5 && r.bustPressureT > 6) {
        r.bustPressureT = 0;
        const hunters = this.enemies.filter((e) => e.alive && e.seg === r.step).length;
        if (hunters < 6) {
          r.bustWaves = (r.bustWaves ?? 0) + 1;
          const behind = r.bustWaves >= 3;
          if (!this.spawnBustReinforcements(2, behind)) {
            this.spawnBustReinforcements(2, !behind);
          }
        }
      }
    }

    // reaching the decision room — trigger from ANY cell of the 3x3 room.
    // Objectives that demand action gate the checkpoint; if the player
    // stalls there, the squad resolves it for them after a few seconds.
    const roomCell = this.map.rooms[r.step - 1];
    if (roomCell) {
      const pc = this.map.cellAt(playerPos.x, playerPos.z);
      if (Math.abs(pc.x - roomCell.x) <= 1 && Math.abs(pc.z - roomCell.z) <= 1) {
        if (r.lethal) {
          // ambushed at the threshold — the round was always ending here,
          // but the trap springs as soldiers pouring in, not unseen hits
          if (!r.bustAmbushed) {
            r.bustAmbushed = true;
            const got = this.spawnBustReinforcements(3, false) ||
              this.spawnBustReinforcements(2, true);
            if (!got) this.applyPlayerHit(1.4); // absolute last resort
          }
        } else if (o && !o.done && o.mech !== 'hold') {
          o.stallT += dt;
          o.hintT -= dt;
          if (o.hintT <= 0) {
            o.hintT = 2.5;
            this.cb.onObjectiveHint?.(o.title);
          }
          if (o.stallT > 6) this.autoResolveObjective();
        } else if (o && o.done) {
          if (r.step >= this.map.segments) this.finishRoundWin();
          else if (!this.gatePhase) this.enterGatePhase();
        }
      }
    }
  }

  // Reinforcements for the scripted bust: spawned where the player can't
  // see them (LOS-blocked segment cells, or directly behind the camera's
  // back for late waves) and set charging so they enter the scene as
  // soldiers arriving, not as damage from nowhere.
  spawnBustReinforcements(count = 2, behind = false) {
    const r = this.round;
    if (!r) return 0;
    const S = this.map.cellSize;
    const eye = this.camera.position.clone();
    const walkable = this.botCtxExtras().isWalkable;
    const spots = [];
    if (behind) {
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(this.camera.quaternion);
      back.y = 0;
      back.normalize();
      for (let i = 0; i < count; i++) {
        for (const d of [6, 8, 4.5]) {
          const px = eye.x + back.x * d + (Math.random() - 0.5) * 2.4;
          const pz = eye.z + back.z * d + (Math.random() - 0.5) * 2.4;
          if (!walkable(px, pz, 0.45)) continue;
          spots.push(new THREE.Vector3(px, 0, pz));
          break;
        }
      }
    } else {
      const cells = this.map.path.filter((p) => p.seg === r.step || p.seg === r.step + 1);
      const shuffled = [...cells].sort(() => Math.random() - 0.5);
      for (const c of shuffled) {
        if (spots.length >= count) break;
        const pos = new THREE.Vector3(
          c.x * S + (Math.random() - 0.5) * 2.4, 0, c.z * S + (Math.random() - 0.5) * 2.4
        );
        const d = Math.hypot(pos.x - eye.x, pos.z - eye.z);
        if (d < 8 || d > 42) continue;
        if (this.losClear(eye, pos.clone().setY(1.4))) continue; // must be hidden
        if (!walkable(pos.x, pos.z, 0.45)) continue;
        spots.push(pos);
      }
    }
    for (const pos of spots) {
      const e = new EnemyBot(this.scene, pos, null, r.step, { weapon: this.enemyWeapon(0.1) });
      e.engage();
      e.temper.brave = true;
      e.mode = 'charge';
      e.modeT = 6 + Math.random() * 3;
      this.enemies.push(e);
      r.segEnemyTotal++;
    }
    if (spots.length > 0) sound.alarm();
    return spots.length;
  }

  spawnHoldWave(step, room) {
    // attackers pour in from the corridor cells around the hold zone
    const S = this.map.cellSize;
    const candidates = this.map.path.filter((p) =>
      p.seg === step || p.seg === step + 1);
    for (let i = 0; i < 3; i++) {
      const c = candidates[Math.floor(Math.random() * candidates.length)];
      if (!c) break;
      const e = new EnemyBot(this.scene,
        new THREE.Vector3(c.x * S + (Math.random() - 0.5) * 2, 0, c.z * S + (Math.random() - 0.5) * 2),
        null, step, { weapon: this.enemyWeapon() });
      e.engage();
      this.enemies.push(e);
      this.round.segEnemyTotal++;
    }
    sound.alarm();
  }

  // ------------------------------------------------------- decision gates
  //
  // Reaching a cleared checkpoint spawns two holographic route gates at the
  // room's exit — walking through one IS the decision. A cash-out banner
  // shows until a gate is crossed.

  enterGatePhase() {
    const r = this.round;
    r.curRung = r.rungTarget; // this rung is now secured
    r.pot = r.bet * r.curRung;
    this.cb.onPot?.(r.pot, r.pot);
    // wrap up segment furniture: secure the asset, clear the site beacon
    if (this.npc) {
      this.cb.onAssetSecured?.();
      this.npc.dispose();
      this.npc = null;
    }
    if (this.objective?.beacon) {
      this.scene.remove(this.objective.beacon);
      this.objective.beacon = null;
    }

    this.clearLockedGates(); // sealed gates light up into route gates
    const S = this.map.cellSize;
    const roomCell = this.map.rooms[r.step - 1];
    const roomPos = new THREE.Vector3(roomCell.x * S, 0, roomCell.z * S);
    const exits = roomCell.exits ?? [];
    const options = this.mission.decisions?.[r.step - 1] ??
      [{ t: 'Push forward', risk: 'std' }, { t: 'Flank around', risk: 'std' }, { t: 'Go loud', risk: 'risky' }];

    const gates = [];
    const slots = [];
    const nextStep = r.step + 1;
    const fmtPay = (gain) => '$' + (r.bet * r.curRung * gain).toFixed(2);

    const buildSlot = (opt) => {
      const { p, gain } = optionStats(r.plan, nextStep, RISK_FACTORS[opt.risk] ?? 1);
      return { t: opt.t, risk: opt.risk, p, gain, pct: Math.round(p * 100) };
    };

    if (exits.length >= 2) {
      // one gate per doorway, filling the corridor entrance
      for (let i = 0; i < exits.length && i < options.length; i++) {
        const slot = buildSlot(options[i]);
        const gate = makeGate(slot.t, { risk: slot.risk, pct: slot.pct, pay: fmtPay(slot.gain), width: 4.7 });
        const cell = exits[i].cell;
        gate.position.set(cell.x * S, 0, cell.z * S);
        gate.rotation.y = Math.atan2(roomPos.x - gate.position.x, roomPos.z - gate.position.z);
        this.scene.add(gate);
        gates.push(gate);
        slots.push({ ...slot, cell, dir: exits[i].dir });
      }
      this.gatePhase = { mode: 'doorways', gates, slots, t: 0 };
    } else {
      // fallback: single doorway — two gates side by side inside it
      const exit = exits[0] ?? { dir: { x: 0, z: 1 }, cell: { x: roomCell.x, z: roomCell.z + 2 } };
      const h = new THREE.Vector3(exit.dir.x, 0, exit.dir.z);
      const lat = new THREE.Vector3(h.z, 0, -h.x);
      const mid = new THREE.Vector3(exit.cell.x * S, 0, exit.cell.z * S);
      for (let i = 0; i < 2; i++) {
        const slot = buildSlot(options[i]);
        const gate = makeGate(slot.t, { risk: slot.risk, pct: slot.pct, pay: fmtPay(slot.gain), width: 2.6 });
        gate.position.copy(mid).addScaledVector(lat, i === 0 ? -1.45 : 1.45);
        gate.rotation.y = Math.atan2(roomPos.x - mid.x, roomPos.z - mid.z);
        this.scene.add(gate);
        gates.push(gate);
        slots.push(slot);
      }
      this.gatePhase = { mode: 'split', gates, slots, mid, h, lat, t: 0 };
    }

    sound.step();
    this.cb.onGatePhase?.({
      step: r.step,
      pot: r.pot,
      canCash: r.curRung >= 1,
      nextTitle: this.mission.objectives?.[r.step]?.title ?? null
    });
  }

  updateGatePhase(dt) {
    const gp = this.gatePhase;
    if (!gp) return;
    gp.t += dt;
    for (let i = 0; i < gp.gates.length; i++) {
      const g = gp.gates[i];
      const text = g.userData.textMesh;
      if (text) {
        text.position.y = g.userData.textY + Math.sin(gp.t * 1.7 + i * 1.3) * 0.07;
        text.material.opacity = 0.82 + Math.sin(gp.t * 3.1 + i) * 0.16;
      }
      if (g.userData.frameMat) {
        g.userData.frameMat.opacity = 0.5 + Math.sin(gp.t * 2.3 + i * 0.7) * 0.2;
      }
    }
    const p = this.player.pos;
    if (gp.mode === 'doorways') {
      // stepping into a doorway cell makes the call
      const pc = this.map.cellAt(p.x, p.z);
      for (let i = 0; i < gp.slots.length; i++) {
        const c = gp.slots[i].cell;
        if (pc.x === c.x && pc.z === c.z) {
          this.chooseGate(i);
          return;
        }
      }
    } else {
      // split mode: crossing the doorway line picks the nearer gate
      const d = (p.x - gp.mid.x) * gp.h.x + (p.z - gp.mid.z) * gp.h.z;
      if (d > -2.2) {
        const side = (p.x - gp.mid.x) * gp.lat.x + (p.z - gp.mid.z) * gp.lat.z;
        this.chooseGate(side >= 0 ? 1 : 0);
      }
    }
  }

  chooseGate(idx) {
    const gp = this.gatePhase;
    if (!gp) return;
    for (const g of gp.gates) {
      this.scene.remove(g);
      g.traverse((o) => { o.material?.map?.dispose?.(); o.material?.dispose?.(); o.geometry?.dispose?.(); });
    }
    const slot = gp.slots[idx] ?? gp.slots[0];
    const r = this.round;
    // commit the option: draw this step's outcome at its true odds and set
    // the rung it plays for — EV is identical across options
    r.pendingBust = !this.rng.chance(slot.p);
    r.rungTarget = r.curRung * slot.gain;
    this.gatePhase = null;
    sound.click();
    this.cb.onGateChoice?.(slot.t, slot);
    this.beginSegment(r.step + 1);
  }

  finishRoundWin() {
    const r = this.round;
    r.over = true;
    r.curRung = r.rungTarget;
    r.pot = r.bet * r.curRung;
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
      onPlayerHit: (s) => this.applyPlayerHit(s),
      // squadmate-down broadcast: nearby enemies visibly react
      deathEvent: this.lastKillEvent,
      // an engaged enemy pulls nearby patrols into the fight
      callAllies: (src) => {
        for (const o of this.enemies) {
          if (o !== src && o.alive && o.state === 'patrol' && !o.stealthMode &&
              o.group.position.distanceToSquared(src.group.position) < 196) {
            o.engage();
          }
        }
      },
      ...this.botCtxExtras()
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
        this.updateProjectiles(dt);
        this.updateGatePhase(dt);
        if (this.mode === 'play') this.updatePlayFlow(dt);

        const r = this.round;
        for (const e of this.enemies) {
          e.update(dt, {
            ...enemyCtx,
            lethal: r.lethal && e.seg === r.step
          });
        }
        this.updateComrades(dt, true);
        this.separateBots();

        // rigged first-person arms run the same clips the bots use
        this.updateViewmodelPose(dt);

        // viewmodel kick recovery + look-lag sway
        if (this.viewmodel) {
          // grenade toss gesture: rifle dips aside for a beat and returns
          let toss = 0;
          if (this.throwAnimT > 0) {
            this.throwAnimT -= dt;
            toss = Math.sin(Math.PI * (1 - Math.max(0, this.throwAnimT) / 0.55));
          }
          const base = this.vmBase ?? new THREE.Vector3(0.24, -0.22, -0.5);
          this.viewmodel.position.z += (base.z - this.viewmodel.position.z) * Math.min(1, dt * 14);
          const targetX = (this.controls.scoped ? base.x - 0.24 : base.x) + toss * 0.12;
          const targetY = (this.controls.scoped ? base.y + 0.08 : base.y) - toss * 0.2 + Math.sin(this.player.bob) * 0.006;
          this.viewmodel.position.x += (targetX - this.viewmodel.position.x) * Math.min(1, dt * 10);
          this.viewmodel.position.y += (targetY - this.viewmodel.position.y) * Math.min(1, dt * 10);
          const dyaw = this.controls.yaw - (this.lastYaw ?? this.controls.yaw);
          this.lastYaw = this.controls.yaw;
          const swayTarget = THREE.MathUtils.clamp(dyaw * 5, -0.08, 0.08);
          if (this.vmSway === undefined) this.vmSway = 0;
          this.vmSway += (swayTarget - this.vmSway) * Math.min(1, dt * 9);
          this.viewmodel.rotation.y = this.vmSway;
          this.viewmodel.rotation.x = -toss * 0.5;
          this.viewmodel.rotation.z = this.vmSway * 0.5 - this.controls.move.x * 0.02 + toss * 0.3;
        }
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

    // keep the sun's shadow frustum centered on the action; the sky dome
    // and sun impostor ride with the camera so their rims never show
    const sun = this.world.userData.sun;
    if (sun) {
      const anchor = this.mode === 'lobby' ? this.camera.position : this.player.pos;
      sun.position.set(anchor.x + 45, 75, anchor.z + 28);
      sun.target.position.set(anchor.x, 0, anchor.z);
    }
    const dome = this.world.userData.skyDome;
    if (dome) dome.position.set(this.camera.position.x, 0, this.camera.position.z);
    const sunSprite = this.world.userData.sunSprite;
    if (sunSprite) {
      sunSprite.position.set(this.camera.position.x + 140, 200, this.camera.position.z + 90);
    }

    this.renderer.render(this.scene, this.camera);
  }

  updateComrades(dt, combat) {
    const r = this.round;
    // squad moves crouched while a stealth objective is live and unblown
    const o = this.objective;
    const sneaking = !!o && o.mech === 'stealth' && !o.done && !o.compromised;
    // time since the commander last moved — the squad settles into a
    // watching perimeter on long halts instead of freezing mid-stride
    const playerMoving = Math.abs(this.controls.move.x) + Math.abs(this.controls.move.z) > 0.01;
    this.haltT = playerMoving || this.mode !== 'play' ? 0 : (this.haltT ?? 0) + dt;
    // the formation's axis: follows the commander's heading slowly while
    // marching and FREEZES on halts, so looking around never swings the
    // column targets (that swing made idle comrades shuffle and re-kneel
    // on every camera turn)
    if (this.columnYaw === undefined) this.columnYaw = this.controls.yaw;
    if (playerMoving) {
      let dy = this.controls.yaw - this.columnYaw;
      dy = ((dy + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      this.columnYaw += Math.max(-2.5 * dt, Math.min(2.5 * dt, dy));
    }
    // watch sectors on halt: right flank, left flank, rear, forward
    const WATCH = [Math.PI * 0.55, -Math.PI * 0.55, Math.PI, 0.25];

    // decision gates up: the two nearest comrades peel off and stack up on
    // either side of the entrance the commander is walking toward, covering
    // the breach until the choice is made
    const stackByComrade = new Map();
    const gp = this.gatePhase;
    if (gp && this.comrades.length >= 2) {
      const S = this.map.cellSize;
      const pp = this.player.pos;
      let best = null, bd = Infinity;
      if (gp.mode === 'doorways') {
        for (const s of gp.slots) {
          if (!s.dir) continue;
          const gx = s.cell.x * S, gz = s.cell.z * S;
          const d = (pp.x - gx) ** 2 + (pp.z - gz) ** 2;
          if (d < bd) { bd = d; best = { x: gx, z: gz, dir: s.dir }; }
        }
      } else if (gp.mid) {
        best = { x: gp.mid.x, z: gp.mid.z, dir: { x: gp.h.x, z: gp.h.z } };
      }
      // hysteresis: only re-target another doorway once it is clearly closer,
      // and drop the role assignment so sides re-match to the new axis
      if (best) {
        const cur = gp.stackGate;
        if (!cur || (cur.x - best.x) ** 2 + (cur.z - best.z) ** 2 > 0.1) {
          const curD = cur ? (pp.x - cur.x) ** 2 + (pp.z - cur.z) ** 2 : Infinity;
          if (bd < curD - 16) {
            gp.stackGate = best;
            gp.stackAssign = null;
          } else if (!cur) {
            gp.stackGate = best;
          }
        }
      }
      const gate = gp.stackGate;
      if (gate) {
        const walk = this.botCtxExtras().isWalkable;
        const yaw = Math.atan2(gate.dir.x, gate.dir.z);
        const bx = gate.x - gate.dir.x * 1.9, bz = gate.z - gate.dir.z * 1.9;
        const px = gate.dir.z, pz = -gate.dir.x; // door axis (lateral)
        const mk = (side) => {
          const sx = bx + px * 1.5 * side, sz = bz + pz * 1.5 * side;
          return walk(sx, sz, 0.5) ? { pos: new THREE.Vector3(sx, 0, sz), yaw } : null;
        };
        // assign ONCE per gate: the two comrades nearest the door take the
        // side of the door axis they are already on, so their approach
        // paths never cross (crossing caused a per-frame role flip-flop
        // that read as the pair vibrating against each other)
        if (!gp.stackAssign) {
          const order = this.comrades.map((c, i) => ({
            i,
            d: (c.group.position.x - gate.x) ** 2 + (c.group.position.z - gate.z) ** 2
          })).sort((a, b) => a.d - b.d).filter((o) => o.d < 256).slice(0, 2);
          const sideOf = (i) => {
            const c = this.comrades[i].group.position;
            return Math.sign((c.x - bx) * px + (c.z - bz) * pz) || 1;
          };
          if (order.length) {
            const a = order[0].i, b = order[1]?.i;
            const sa = sideOf(a);
            gp.stackAssign = [[a, sa]];
            if (b !== undefined) gp.stackAssign.push([b, -sa]);
          }
        }
        if (gp.stackAssign) {
          for (const [i, side] of gp.stackAssign) {
            const st = mk(side);
            if (st) stackByComrade.set(i, st);
          }
        }
      }
    }

    for (let i = 0; i < this.comrades.length; i++) {
      const colOffset = this.comradeSlots[i] - this.playerSlot;
      const dist = Math.abs(colOffset) * COLUMN_SPACING + (colOffset > 0 ? 1.1 : 0);
      const targetPos = colOffset < 0 ? this.routeAheadPoint(dist) : this.trailBehindPoint(dist);
      const stack = stackByComrade.get(i);
      this.comrades[i].update(dt, {
        stackPos: stack?.pos ?? null,
        stackYaw: stack?.yaw ?? 0,
        targetPos,
        playerYaw: this.controls.yaw,
        playerPos: this.player.pos,
        haltT: this.haltT,
        sneaking,
        columnYaw: this.columnYaw,
        watchYaw: this.columnYaw + Math.PI + WATCH[i % WATCH.length],
        facePlayer: i === this.comrades.length - 1,
        // comrades never touch the HVT — that kill belongs to the commander
        enemies: combat
          ? this.enemies.filter((e) => !e.isHVT && (e.seg === r.step || e.state === 'combat'))
          : [],
        effects: this.effects,
        graceElapsed: combat && r.segTime > 4.5,
        onComradeKill: (e) => this.registerKill(e, 'comrade'),
        ...this.botCtxExtras()
      });
    }

    // escort asset trails the whole column once picked up
    if (this.npc) {
      const behind = (this.comradeSlots.length + 1) * COLUMN_SPACING + 1.4;
      this.npc.update(dt, {
        targetPos: this.npcActive ? this.trailBehindPoint(behind) : this.npc.group.position.clone(),
        playerYaw: this.controls.yaw,
        playerPos: this.player.pos,
        enemies: [],
        effects: this.effects,
        graceElapsed: false,
        ...this.botCtxExtras()
      });
    }
  }
}
