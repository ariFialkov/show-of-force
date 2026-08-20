// Enemy and comrade bot behavior.
//
// Enemies are theater: they patrol, shoot NEAR the player (never hitting
// unless the round script says the player busts here), and get finished off
// by comrades if the player ignores them. Comrades follow the player and
// guarantee every active enemy dies eventually.

import * as THREE from 'three';
import { makeSoldier, animateWalk, poseIdle, poseCombat, poseFire, poseStun, startDeath, startHit, startReload } from './models.js';
import { sound } from './effects.js';

// reddish insurgent fatigues with desaturated gear so the vest/helmet read
// as separate equipment instead of one flat mass
const ENEMY_CAMO = { cloth: 0x6b4035, vest: 0x453c31, helmet: 0x2f2a23, skin: 0xb98d5e };
const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

let nextBotId = 1;

// Rate-limited shortest-arc turn toward a heading, so characters visibly
// rotate (the walk/idle cycle sells the turn) instead of snap-facing.
// A 180 at the default rate takes ~0.45s.
function slewYaw(group, target, dt, rate = 7) {
  let d = target - group.rotation.y;
  d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  group.rotation.y += Math.max(-rate * dt, Math.min(rate * dt, d));
}

export class EnemyBot {
  constructor(scene, pos, patrolTo, seg, opts = {}) {
    this.id = nextBotId++;
    this.scene = scene;
    this.seg = seg;
    this.elevated = opts.elevated ?? false; // e.g. tower snipers never move
    this.group = makeSoldier(ENEMY_CAMO);
    this.group.position.copy(pos);
    this.group.userData.enemyId = this.id;
    scene.add(this.group);
    this.baseY = pos.y;

    this.home = pos.clone();
    this.patrolTo = patrolTo ? patrolTo.clone() : null;
    this.patrolT = Math.random();
    this.patrolDir = 1;

    this.hp = 2;
    this.stunT = 0;
    this.state = 'patrol'; // patrol | combat | dying | dead
    this.fireTimer = 1 + Math.random() * 1.6;
    this.burstLeft = 0;
    this.burstTimer = 0;
    this.burstsFired = 0;
    this.reloadT = 0;
    this.deathT = 0;
    this.walkT = Math.random() * 10;
  }

  get alive() { return this.state === 'patrol' || this.state === 'combat'; }

  engage() {
    if (this.state === 'patrol') {
      this.state = 'combat';
      this.fireTimer = 0.4 + Math.random() * 1.2;
    }
  }

  // blastFrom (optional, explosion kills): the blast center — the body is
  // turned so the baked launch (along its facing) carries it away from it
  takeHit(effects, cause = 'gunfire', blastFrom = null) {
    if (!this.alive) return false;
    this.hp -= 1;
    effects.hitSpark(tmpV.copy(this.group.position).setY(1.0).add(
      tmpV2.set((Math.random() - 0.5) * 0.4, Math.random() * 0.4, (Math.random() - 0.5) * 0.4)
    ));
    if (this.hp <= 0) {
      this.state = 'dying';
      this.deathT = 0;
      if (cause === 'explosion' && blastFrom) {
        const p = this.group.position;
        this.group.rotation.y = Math.atan2(p.x - blastFrom.x, p.z - blastFrom.z);
      }
      this.deathClipDur = startDeath(this.group, cause); // 0 -> procedural collapse
      return true;
    }
    startHit(this.group); // survived — flinch
    return false;
  }

  update(dt, ctx) {
    const { playerPos, effects, lethal, onPlayerHit } = ctx;
    this.walkT += dt;

    if (this.state === 'dying') {
      this.deathT += dt;
      if (this.deathClipDur > 0) {
        // baked death clip drives the fall; hold the final frame briefly
        this.group.userData.tick?.(dt);
        if (this.deathT > this.deathClipDur + 0.8) {
          this.group.visible = false;
          this.state = 'dead';
        }
        return;
      }
      const t = Math.min(1, this.deathT / 0.5);
      this.group.rotation.x = -t * Math.PI / 2;
      this.group.position.y = this.baseY - t * 0.15;
      // limbs sprawl as they go down (skeleton is frozen — no tick)
      const parts = this.group.userData.parts;
      if (parts.armL) parts.armL.rotation.z += t * 0.02;
      if (parts.armR) parts.armR.rotation.z -= t * 0.02;
      if (this.deathT > 3) {
        this.group.visible = false;
        this.state = 'dead';
      }
      return;
    }
    if (this.state === 'dead') return;

    this.group.userData.tick?.(dt); // rigged models advance their idle clip

    // flash-stunned: dazed in place, can't fight
    if (this.stunT > 0) {
      this.stunT -= dt;
      poseStun(this.group, this.walkT);
      return;
    }

    if (this.state === 'patrol') {
      if (this.patrolTo) {
        this.patrolT += dt * 0.14 * this.patrolDir;
        if (this.patrolT > 1) { this.patrolT = 1; this.patrolDir = -1; }
        if (this.patrolT < 0) { this.patrolT = 0; this.patrolDir = 1; }
        this.group.position.lerpVectors(this.home, this.patrolTo, this.patrolT);
        tmpV.subVectors(this.patrolDir > 0 ? this.patrolTo : this.home, this.group.position);
        if (tmpV.lengthSq() > 0.001) {
          slewYaw(this.group, Math.atan2(tmpV.x, tmpV.z), dt, 4.5);
        }
        animateWalk(this.group, this.walkT, 0.6);
      } else {
        poseIdle(this.group, this.walkT);
        this.group.rotation.y += Math.sin(this.walkT * 0.4) * dt * 0.3;
      }
      return;
    }

    // combat: fire only with a clear line of sight; hunt the player's
    // position otherwise instead of blind-firing through walls
    const eye = tmpV2.copy(this.group.position);
    eye.y += 1.5;
    const canSee = ctx.los ? ctx.los(eye, playerPos) : true;

    if (!canSee) {
      this.burstLeft = 0;
      if (!this.elevated) {
        // advance toward the player, axis-separated so walls stop us
        tmpV.subVectors(playerPos, this.group.position);
        tmpV.y = 0;
        const d = tmpV.length();
        if (d > 2.2) {
          tmpV.normalize();
          const spd = 1.7 * dt;
          const p = this.group.position;
          if (ctx.isWalkable?.(p.x + tmpV.x * spd + Math.sign(tmpV.x) * 0.5, p.z) ?? true) p.x += tmpV.x * spd;
          if (ctx.isWalkable?.(p.x, p.z + tmpV.z * spd + Math.sign(tmpV.z) * 0.5) ?? true) p.z += tmpV.z * spd;
          slewYaw(this.group, Math.atan2(tmpV.x, tmpV.z), dt, 8);
          animateWalk(this.group, this.walkT, 0.8);
          return;
        }
      }
      poseCombat(this.group, this.walkT); // alert, weapon up, no target
      return;
    }

    tmpV.subVectors(playerPos, this.group.position);
    slewYaw(this.group, Math.atan2(tmpV.x, tmpV.z), dt, 10);
    if (this.burstLeft > 0) poseFire(this.group, this.walkT);
    else poseCombat(this.group, this.walkT);

    // mid-magazine change: weapon down, no shooting until it finishes
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      return;
    }

    this.fireTimer -= dt;
    if (this.fireTimer <= 0 && this.burstLeft <= 0) {
      if (this.burstsFired >= 3) {
        this.burstsFired = 0;
        this.reloadT = startReload(this.group) || 1.4;
        this.fireTimer = 0.3 + Math.random() * 0.6;
        return;
      }
      this.burstLeft = 3 + Math.floor(Math.random() * 3);
      this.burstTimer = 0;
      this.burstsFired++;
      this.fireTimer = 1.4 + Math.random() * 1.8;
    }
    if (this.burstLeft > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this.burstTimer = 0.11;
        this.burstLeft--;
        this.fireAt(playerPos, effects, lethal, onPlayerHit, ctx.clip);
      }
    }
  }

  fireAt(playerPos, effects, lethal, onPlayerHit, clip) {
    const muzzle = this.group.userData.parts.muzzle;
    const from = new THREE.Vector3();
    muzzle.getWorldPosition(from);
    let target = playerPos.clone();
    if (lethal) {
      // scripted bust: rounds connect
      onPlayerHit?.(0.5 + Math.random() * 0.5);
    } else {
      // near-miss: offset the impact point so tracers whiz past the camera
      const side = new THREE.Vector3().subVectors(target, from).cross(UP).normalize();
      const miss = (Math.random() < 0.5 ? 1 : -1) * (0.7 + Math.random() * 1.3);
      target.addScaledVector(side, miss);
      target.y += (Math.random() - 0.35) * 1.2;
    }
    if (clip) target = clip(from, target); // rounds stop at solid cover
    effects.tracer(from, target, false);
    effects.muzzleFlash(from, new THREE.Vector3().subVectors(target, from).normalize());
    sound.enemyShot();
  }

  dispose() {
    this.scene.remove(this.group);
  }
}

export class Comrade {
  constructor(scene, camo, roster, model = null, opts = {}) {
    this.scene = scene;
    this.group = model ?? makeSoldier(camo, opts);
    scene.add(this.group);
    this.callsign = roster?.callsign ?? 'Bravo';
    this.walkT = Math.random() * 10;
    this.killTimer = 0;
    this.fireAnimT = 0;
    this.shotsFired = Math.floor(Math.random() * 4); // desync squad reloads
    this.smooth = new THREE.Vector3();
    this.initialized = false;
  }

  // Column movement: seek an assigned column point (computed by the game —
  // ahead of the commander along the mission route, or behind along the
  // commander's own trail), stopping to trade fire when enemies are up.
  update(dt, ctx) {
    const { targetPos, playerYaw, enemies, effects, graceElapsed, onComradeKill } = ctx;

    this.group.userData.tick?.(dt); // rigged models advance their idle clip

    if (!this.initialized) {
      this.smooth.copy(targetPos);
      this.initialized = true;
    }

    // pick nearest live engaged enemy WE CAN SEE — no firing through walls
    let target = null, best = Infinity;
    for (const e of enemies) {
      if (!e.alive || e.state !== 'combat') continue;
      const d = e.group.position.distanceToSquared(this.smooth);
      if (d >= best) continue;
      if (ctx.los) {
        tmpV2.set(this.smooth.x, 1.5, this.smooth.z);
        tmpV.copy(e.group.position);
        tmpV.y += 1.4;
        if (!ctx.los(tmpV2, tmpV)) continue;
      }
      best = d;
      target = e;
    }

    tmpV.subVectors(targetPos, this.smooth);
    tmpV.y = 0;
    const dist = tmpV.length();
    const holdForFight = target !== null && dist < 7;
    let moving = false;
    let gait = 1;
    if (!holdForFight && dist > 0.22) {
      const speed = THREE.MathUtils.clamp(1.6 + dist * 1.7, 0, 6.8);
      const step = Math.min(dist, speed * dt);
      tmpV.normalize();
      this.smooth.addScaledVector(tmpV, step);
      slewYaw(this.group, Math.atan2(tmpV.x, tmpV.z), dt, 9);
      moving = step > dt * 0.7;
      gait = speed / 1.9; // walk near formation, break into a run to catch up
    }
    this.group.position.copy(this.smooth);

    if (target) {
      tmpV2.subVectors(target.group.position, this.group.position);
      slewYaw(this.group, Math.atan2(tmpV2.x, tmpV2.z), dt, 10);
      this.fireAnimT -= dt;
      if (this.fireAnimT > 0) poseFire(this.group, this.walkT);
      else poseCombat(this.group, this.walkT);
      this.killTimer -= dt;
      if (this.killTimer <= 0) {
        this.killTimer = 0.9 + Math.random() * 0.8;
        this.fireAnimT = 0.5;
        const muzzle = this.group.userData.parts.muzzle;
        const from = new THREE.Vector3();
        muzzle.getWorldPosition(from);
        let to = target.group.position.clone();
        to.y += 1.1;
        if (ctx.clip) to = ctx.clip(from, to);
        effects.tracer(from, to, true);
        sound.shot();
        // comrades only *finish* enemies after the player has had their fun
        if (graceElapsed) {
          const died = target.takeHit(effects);
          if (died) onComradeKill?.(target);
        }
        // fresh magazine every few shots — pauses the trigger, not the column
        if (++this.shotsFired >= 6) {
          this.shotsFired = 0;
          const rd = startReload(this.group);
          if (rd > 0) {
            this.killTimer = rd + 0.5;
            this.fireAnimT = 0;
          }
        }
      }
    } else if (moving) {
      this.walkT += dt * 1.4;
      animateWalk(this.group, this.walkT, gait);
    } else {
      this.walkT += dt * 0.25;
      poseIdle(this.group, this.walkT * 4);
      // hold facing the commander's heading (models face +Z; camera yaw 0 faces -Z)
      slewYaw(this.group, playerYaw + Math.PI, dt, 5);
    }
  }

  setPosition(pos, yaw = 0) {
    this.smooth.copy(pos);
    this.group.position.copy(pos);
    this.group.rotation.y = yaw;
    this.initialized = true;
  }

  dispose() {
    this.scene.remove(this.group);
  }
}
