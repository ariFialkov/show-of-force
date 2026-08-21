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

// Per-soldier personality so nobody behaves identically or in lockstep:
// reaction latency, gait speed, formation stagger, halt posture, how they
// scan a sector, and whether they answer contact with aggression or cover.
function makeTemper() {
  return {
    delay: 0.12 + Math.random() * 0.55,
    gait: 0.9 + Math.random() * 0.2,
    side: (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 0.85),
    kneels: Math.random() < 0.45,
    scanRate: 0.35 + Math.random() * 0.55,
    scanPhase: Math.random() * 10,
    scanWidth: 0.3 + Math.random() * 0.4,
    brave: Math.random() < 0.4
  };
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

    // combat personality + tactical state
    this.temper = makeTemper();
    this.mode = 'fight'; // fight | charge | tuck | peek | fallback
    this.modeT = 0;
    this.combatT = 0;
    this.calledHelp = false;
    this.coverSearched = false;
    this.fellBack = false;
    this.reactedKill = 0;
    this.flank = Math.random() < 0.5 ? -1 : 1;
    this.strafeT = 2 + Math.random() * 4;
    this.strafeGoal = null;
  }

  get alive() { return this.state === 'patrol' || this.state === 'combat'; }

  engage() {
    if (this.state === 'patrol') {
      this.state = 'combat';
      this.fireTimer = 0.4 + Math.random() * 1.2;
      // aggressive types open with a rush; the rest fight from where they are
      if (this.temper.brave && !this.elevated) {
        this.mode = 'charge';
        this.modeT = 2 + Math.random() * 1.2;
      }
    }
  }

  // Walk/run toward a point, steering around walls: try the direct heading
  // first, then progressively wider detour angles, taking the first clear
  // one. Returns true when arrived, hard-blocked, or stuck (no progress),
  // so callers never leave a soldier jogging into a wall.
  stepToward(goal, spd, dt, ctx, gait) {
    const p = this.group.position;
    tmpV.set(goal.x - p.x, 0, goal.z - p.z);
    const d = tmpV.length();
    const navKey = ((goal.x * 4) | 0) * 65536 + ((goal.z * 4) | 0);
    if (navKey !== this.navKey) {
      this.navKey = navKey;
      this.navBest = Infinity;
      this.navStuck = 0;
    }
    if (d < 0.25) return true;
    // stuck watchdog: abandon goals that stop getting closer
    if (d < this.navBest - 0.08) {
      this.navBest = d;
      this.navStuck = 0;
    } else {
      this.navStuck += dt;
      if (this.navStuck > 1.4) return true;
    }
    const s = Math.min(d, spd * dt);
    const base = Math.atan2(tmpV.x, tmpV.z);
    for (const off of [0, 0.55, -0.55, 1.1, -1.1, 1.75, -1.75]) {
      const a = base + off;
      const sx = Math.sin(a), sz = Math.cos(a);
      // look a stride ahead so we steer before touching the wall
      if ((ctx.isWalkable?.(p.x + sx * (s + 0.55), p.z + sz * (s + 0.55)) ?? true) &&
          (ctx.isWalkable?.(p.x + sx * s, p.z + sz * s) ?? true)) {
        p.x += sx * s;
        p.z += sz * s;
        slewYaw(this.group, a, dt, 8);
        animateWalk(this.group, this.walkT, gait * this.temper.gait);
        return false;
      }
    }
    return true; // boxed in — let the caller pick a new plan
  }

  // Find a nearby spot where the wall geometry actually blocks the player's
  // line of sight — real cover, not a scripted point. Searches outward in
  // rings, never picking a spot that closes distance on the player.
  findCover(ctx, playerPos) {
    if (!ctx.los) return false;
    const p = this.group.position;
    const dPlayer = Math.hypot(playerPos.x - p.x, playerPos.z - p.z);
    for (let ring = 0; ring < 3; ring++) {
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 + Math.random() * 0.5;
        const r = 1.3 + ring * 1.6 + Math.random() * 1.4;
        const x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r;
        if (!(ctx.isWalkable?.(x, z) ?? true)) continue;
        if (Math.hypot(playerPos.x - x, playerPos.z - z) < Math.min(dPlayer, 3.5)) continue;
        tmpV.set(x, 1.45, z);
        if (!ctx.los(tmpV, playerPos)) {
          this.tuckPos = new THREE.Vector3(x, 0, z);
          this.peekPos = p.clone();
          return true;
        }
      }
    }
    return false;
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

    // squadmate went down nearby: patrols snap to combat, cautious fighters
    // scatter for (new) cover, aggressive ones answer with a rush.
    // Unaware stealth-objective targets stay oblivious for game balance.
    const dk = ctx.deathEvent;
    if (dk && dk.t !== this.reactedKill && !this.stealthMode &&
        performance.now() - dk.t < 900) {
      const ddx = this.group.position.x - dk.x, ddz = this.group.position.z - dk.z;
      if (ddx * ddx + ddz * ddz < 144) {
        this.reactedKill = dk.t;
        if (this.state === 'patrol') this.engage();
        else if (!this.elevated) {
          if (this.temper.brave) { this.mode = 'charge'; this.modeT = 1.8 + Math.random(); }
          else { this.mode = 'fight'; this.coverSearched = false; this.tuckPos = null; }
        }
      }
    }

    if (this.state === 'patrol') {
      // one-time route audit: a patrol leg that clips through walls gets
      // demoted to a stationary guard post instead of wall-ghosting
      if (this.patrolTo && this.patrolChecked === undefined) {
        this.patrolChecked = true;
        for (let k = 0; k <= 5; k++) {
          const t = k / 5;
          const x = this.home.x + (this.patrolTo.x - this.home.x) * t;
          const z = this.home.z + (this.patrolTo.z - this.home.z) * t;
          if (!(ctx.isWalkable?.(x, z, 0.4) ?? true)) {
            this.patrolTo = null;
            break;
          }
        }
      }
      if (this.patrolTo) {
        this.patrolT += dt * 0.14 * this.patrolDir;
        if (this.patrolT > 1) { this.patrolT = 1; this.patrolDir = -1; }
        if (this.patrolT < 0) { this.patrolT = 0; this.patrolDir = 1; }
        this.group.position.lerpVectors(this.home, this.patrolTo, this.patrolT);
        tmpV.subVectors(this.patrolDir > 0 ? this.patrolTo : this.home, this.group.position);
        if (tmpV.lengthSq() > 0.001) {
          slewYaw(this.group, Math.atan2(tmpV.x, tmpV.z), dt, 4.5);
        }
        animateWalk(this.group, this.walkT, 0.6 * this.temper.gait);
      } else {
        poseIdle(this.group, this.walkT);
        this.group.rotation.y += Math.sin(this.walkT * 0.4) * dt * 0.3;
      }
      return;
    }

    // ---- combat
    this.group.userData.crouched = false;
    this.combatT += dt;
    if (!this.calledHelp && this.combatT > 1.8) {
      this.calledHelp = true;
      ctx.callAllies?.(this);
    }

    const eye = tmpV2.copy(this.group.position);
    eye.y += 1.5;
    const canSee = ctx.los ? ctx.los(eye, playerPos) : true;
    tmpV.subVectors(playerPos, this.group.position);
    tmpV.y = 0;
    const playerDist = tmpV.length();

    // wounded and pressed: cautious fighters break contact once, regroup
    if (this.hp === 1 && !this.temper.brave && !this.elevated && !this.fellBack &&
        this.mode !== 'fallback' && playerDist < 9) {
      this.fellBack = true;
      tmpV.normalize();
      this.fbGoal = this.group.position.clone().addScaledVector(tmpV, -5.5);
      this.mode = 'fallback';
      this.modeT = 3.2;
    }

    if (this.mode === 'charge') {
      this.modeT -= dt;
      if (this.modeT <= 0 || playerDist < 6.5 || this.stepToward(playerPos, 3.3, dt, ctx, 1.9)) {
        this.mode = 'fight'; // arrived, blocked or timer out — fight from here
      } else {
        return;
      }
    }

    if (this.mode === 'fallback') {
      this.modeT -= dt;
      const done = this.stepToward(this.fbGoal, 2.7, dt, ctx, 1.5);
      if (done || this.modeT <= 0) {
        this.mode = 'fight';
        this.coverSearched = false;
      } else return;
    }

    // point-blank pressure breaks the cover cycle
    if ((this.mode === 'tuck' || this.mode === 'peek') && playerDist < 3.5) {
      this.mode = 'fight';
      this.tuckPos = null;
    }

    if (this.mode === 'tuck') {
      if (this.stepToward(this.tuckPos, 2.4, dt, ctx, 1.3)) {
        this.group.userData.crouched = true;
        tmpV.subVectors(playerPos, this.group.position);
        slewYaw(this.group, Math.atan2(tmpV.x, tmpV.z), dt, 6);
        poseIdle(this.group, this.walkT); // crouched via flag
        this.modeT -= dt; // dwell starts once actually behind cover
      }
      if (this.modeT <= 0) {
        this.mode = 'peek';
        this.modeT = 1.3 + Math.random() * 1.4;
      }
      return;
    }

    if (this.mode === 'peek') {
      if (this.stepToward(this.peekPos, 2.6, dt, ctx, 1.4)) {
        this.engageFire(dt, canSee, playerPos, ctx);
        this.modeT -= dt;
      }
      if (this.modeT <= 0 && this.tuckPos) {
        this.mode = 'tuck';
        this.modeT = 1.6 + Math.random() * 1.8;
      }
      return;
    }

    // ---- default stand-up fight
    if (!canSee) {
      this.burstLeft = 0;
      if (!this.elevated && playerDist > 2.2) {
        // hunt on a flanking shoulder while far, close directly when near
        let goal = playerPos;
        if (playerDist > 7) {
          const px = tmpV.x / playerDist, pz = tmpV.z / playerDist;
          tmpV2.set(playerPos.x + pz * 3.2 * this.flank, 0, playerPos.z - px * 3.2 * this.flank);
          if (ctx.isWalkable?.(tmpV2.x, tmpV2.z) ?? true) goal = tmpV2;
        }
        if (this.stepToward(goal, 1.8, dt, ctx, 1.0)) {
          // boxed in or no progress — hold alert instead of wall-jogging
          poseCombat(this.group, this.walkT);
        }
        return;
      }
      poseCombat(this.group, this.walkT); // alert, weapon up, no target
      return;
    }

    // first clear sight: cautious fighters dive for real cover
    if (!this.coverSearched && !this.elevated) {
      this.coverSearched = true;
      if (!this.temper.brave && this.findCover(ctx, playerPos)) {
        this.mode = 'tuck';
        this.modeT = 1 + Math.random();
        return;
      }
    }

    // occasional lateral reposition so firefights don't look pinned
    if (!this.elevated) {
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafeT = 2.6 + Math.random() * 3.4;
        const a = Math.random() * Math.PI * 2;
        const x = this.group.position.x + Math.sin(a) * 1.3;
        const z = this.group.position.z + Math.cos(a) * 1.3;
        if (ctx.isWalkable?.(x, z) ?? true) this.strafeGoal = new THREE.Vector3(x, 0, z);
      }
      if (this.strafeGoal) {
        if (this.stepToward(this.strafeGoal, 1.7, dt, ctx, 0.9)) this.strafeGoal = null;
        return;
      }
    }

    this.engageFire(dt, canSee, playerPos, ctx);
  }

  // Aim at the player and run the burst/reload cycle (LOS-gated).
  engageFire(dt, canSee, playerPos, ctx) {
    const { effects, lethal, onPlayerHit } = ctx;
    tmpV.subVectors(playerPos, this.group.position);
    slewYaw(this.group, Math.atan2(tmpV.x, tmpV.z), dt, 10);
    if (this.burstLeft > 0) poseFire(this.group, this.walkT);
    else poseCombat(this.group, this.walkT);
    if (!canSee) {
      this.burstLeft = 0;
      return;
    }

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
    this.temper = makeTemper();
    this.adopted = new THREE.Vector3();
    this.reactT = 0;
    this.posted = false;
    this.kneel = false;
    this.strafeT = 3 + Math.random() * 4;
    this.strafeGoal = null;
  }

  // Formation movement: seek an assigned column point (computed by the game
  // — ahead of the commander along the mission route, or behind along the
  // commander's own trail) with a personal lateral stagger and reaction
  // latency, settle into a watching perimeter on long halts, and stop to
  // trade fire when enemies are up.
  update(dt, ctx) {
    const { targetPos, playerYaw, enemies, effects, graceElapsed, onComradeKill } = ctx;
    const civ = !!this.group.userData.civilian;
    const sneaking = !!ctx.sneaking;

    this.group.userData.tick?.(dt); // rigged models advance their idle clip

    if (!this.initialized) {
      this.smooth.copy(targetPos);
      this.adopted.copy(targetPos);
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

    // personal formation point: staggered off the column line — unless
    // assigned a breach stack position beside a decision doorway
    let dx = targetPos.x, dz = targetPos.z;
    if (ctx.stackPos && !civ) {
      dx = ctx.stackPos.x;
      dz = ctx.stackPos.z;
    } else if (!civ) {
      const rx = -(-Math.cos(playerYaw)), rz = -Math.sin(playerYaw); // right of column
      dx += rx * this.temper.side;
      dz += rz * this.temper.side;
      if (!(ctx.isWalkable?.(dx, dz) ?? true)) { dx = targetPos.x; dz = targetPos.z; }
    }
    // reaction latency: a parked soldier takes a personal beat to set off;
    // once in motion they track the column continuously
    const parked = this.smooth.distanceToSquared(this.adopted) < 0.09;
    const goalMoved = (dx - this.adopted.x) ** 2 + (dz - this.adopted.z) ** 2 > 0.36;
    if (goalMoved && parked) {
      this.reactT += dt;
      if (this.reactT >= this.temper.delay) {
        this.adopted.set(dx, 0, dz);
        this.reactT = 0;
      }
    } else {
      this.adopted.set(dx, 0, dz);
      if (!goalMoved) this.reactT = 0;
    }

    tmpV.subVectors(this.adopted, this.smooth);
    tmpV.y = 0;
    const dist = tmpV.length();
    const holdForFight = target !== null && dist < 7;
    let moving = false;
    let gait = 1;
    if (!holdForFight && dist > 0.22) {
      const speed = THREE.MathUtils.clamp(1.6 + dist * 1.7, 0, 6.8) * this.temper.gait;
      const step = Math.min(dist, speed * dt);
      tmpV.normalize();
      // wall-guarded advance: full step, else slide along one axis
      const nx = this.smooth.x + tmpV.x * step, nz = this.smooth.z + tmpV.z * step;
      const walk = (x, z) => ctx.isWalkable?.(x, z, 0.35) ?? true;
      if (walk(nx, nz)) this.smooth.set(nx, 0, nz);
      else if (walk(nx, this.smooth.z)) this.smooth.x = nx;
      else if (walk(this.smooth.x, nz)) this.smooth.z = nz;
      slewYaw(this.group, Math.atan2(tmpV.x, tmpV.z), dt, 9);
      moving = step > dt * 0.7;
      gait = speed / 1.9; // walk near formation, break into a run to catch up
    }
    this.group.position.copy(this.smooth);
    this.group.userData.crouched = sneaking;

    if (target) {
      this.posted = false;
      // work the angle: occasional short side-steps while engaged
      let strafing = false;
      if (!sneaking) {
        this.strafeT -= dt;
        if (this.strafeT <= 0) {
          this.strafeT = 3.5 + Math.random() * 3;
          const a = Math.random() * Math.PI * 2;
          const sx = this.smooth.x + Math.sin(a) * 1.2;
          const sz = this.smooth.z + Math.cos(a) * 1.2;
          if (ctx.isWalkable?.(sx, sz) ?? true) this.strafeGoal = new THREE.Vector3(sx, 0, sz);
        }
        if (this.strafeGoal) {
          tmpV.subVectors(this.strafeGoal, this.smooth);
          tmpV.y = 0;
          const sd = tmpV.length();
          if (sd < 0.2) this.strafeGoal = null;
          else {
            tmpV.normalize();
            this.smooth.addScaledVector(tmpV, Math.min(sd, 1.6 * dt));
            this.group.position.copy(this.smooth);
            strafing = true;
          }
        }
      }
      tmpV2.subVectors(target.group.position, this.group.position);
      slewYaw(this.group, Math.atan2(tmpV2.x, tmpV2.z), dt, 10);
      this.fireAnimT -= dt;
      if (strafing) animateWalk(this.group, this.walkT, 1);
      else if (this.fireAnimT > 0) poseFire(this.group, this.walkT);
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
      this.posted = false;
      this.walkT += dt * 1.4;
      animateWalk(this.group, this.walkT, gait);
    } else if (ctx.stackPos && !civ && dist < 0.6) {
      // stacked on the doorway: weapon up, covering through the entrance
      this.posted = false;
      this.walkT += dt * 0.25;
      slewYaw(this.group, ctx.stackYaw ?? playerYaw + Math.PI, dt, 6);
      poseCombat(this.group, this.walkT);
    } else if (!civ && (ctx.haltT ?? 0) > 1.1 + this.temper.delay) {
      // long halt: settle into a perimeter — each soldier owns a watch
      // sector and sweeps it, some take a knee, the rear man checks in on
      // the commander. Nobody mirrors the player's aim anymore.
      if (!this.posted) {
        this.posted = true;
        this.kneel = this.temper.kneels;
      }
      this.walkT += dt * 0.25;
      let watch;
      if (ctx.facePlayer && ctx.playerPos) {
        watch = Math.atan2(ctx.playerPos.x - this.group.position.x, ctx.playerPos.z - this.group.position.z);
      } else {
        const scan = Math.sin(this.walkT * 4 * this.temper.scanRate + this.temper.scanPhase) * this.temper.scanWidth;
        watch = (ctx.watchYaw ?? playerYaw + Math.PI) + scan;
      }
      slewYaw(this.group, watch, dt, 3.2);
      this.group.userData.crouched = sneaking || this.kneel;
      poseIdle(this.group, this.walkT * 4);
    } else {
      // brief pause: hold whatever way we were facing, no synced snapping
      this.posted = false;
      this.walkT += dt * 0.25;
      poseIdle(this.group, this.walkT * 4);
      if (civ && ctx.playerPos) {
        slewYaw(this.group, Math.atan2(ctx.playerPos.x - this.group.position.x, ctx.playerPos.z - this.group.position.z), dt, 4);
      }
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
