// Visual effects (tracers, flashes, explosions) and synthesized audio.

import * as THREE from 'three';

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.items = []; // { mesh, life, ttl, update(item, dt) }
    this.tracerMatFriendly = new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true });
    this.tracerMatEnemy = new THREE.MeshBasicMaterial({ color: 0xff8a5a, transparent: true });
    this.tracerGeo = new THREE.BoxGeometry(0.035, 0.035, 1);
  }

  tracer(from, to, friendly = true) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 0.01) return;
    const mesh = new THREE.Mesh(this.tracerGeo, (friendly ? this.tracerMatFriendly : this.tracerMatEnemy).clone());
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    mesh.scale.z = len;
    mesh.lookAt(to);
    this.scene.add(mesh);
    this.items.push({
      mesh, life: 0, ttl: 0.09,
      update: (it) => { it.mesh.material.opacity = 1 - it.life / it.ttl; }
    });
  }

  muzzleFlash(pos, dir) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true })
    );
    mesh.position.copy(pos).addScaledVector(dir, 0.15);
    this.scene.add(mesh);
    this.items.push({
      mesh, life: 0, ttl: 0.055,
      update: (it) => {
        it.mesh.scale.setScalar(1 + it.life * 7);
        it.mesh.material.opacity = 0.9 * (1 - it.life / it.ttl);
      }
    });
  }

  explosion(pos) {
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffb45a, transparent: true })
    );
    core.position.copy(pos);
    this.scene.add(core);
    this.items.push({
      mesh: core, life: 0, ttl: 0.45,
      update: (it) => {
        const t = it.life / it.ttl;
        it.mesh.scale.setScalar(1 + t * 9);
        it.mesh.material.opacity = 0.95 * (1 - t);
        it.mesh.material.color.setHSL(0.08 - t * 0.06, 1, 0.6 - t * 0.25);
      }
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.6, 20),
      new THREE.MeshBasicMaterial({ color: 0xffe0b0, transparent: true, side: THREE.DoubleSide })
    );
    ring.position.copy(pos);
    ring.position.y = 0.15;
    ring.rotation.x = -Math.PI / 2;
    this.scene.add(ring);
    this.items.push({
      mesh: ring, life: 0, ttl: 0.5,
      update: (it) => {
        const t = it.life / it.ttl;
        it.mesh.scale.setScalar(1 + t * 12);
        it.mesh.material.opacity = 0.8 * (1 - t);
      }
    });
  }

  hitSpark(pos) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 5, 4),
      new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true })
    );
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.items.push({
      mesh, life: 0, ttl: 0.18,
      update: (it) => {
        it.mesh.scale.setScalar(1 + it.life * 12);
        it.mesh.material.opacity = 1 - it.life / it.ttl;
      }
    });
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life += dt;
      if (it.life >= it.ttl) {
        this.scene.remove(it.mesh);
        it.mesh.material?.dispose?.();
        this.items.splice(i, 1);
      } else {
        it.update(it, dt);
      }
    }
  }

  clear() {
    for (const it of this.items) this.scene.remove(it.mesh);
    this.items.length = 0;
  }
}

// ---------------------------------------------------------------- audio

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return false; }
      this.ctx = new AC();
      this.noise = this.makeNoiseBuffer();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  makeNoiseBuffer() {
    const len = this.ctx.sampleRate * 0.5;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  burst({ dur = 0.08, freq = 900, gain = 0.25, type = 'lowpass' }) {
    if (!this.enabled || !this.ensure()) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(this.ctx.destination);
    src.start(t);
    src.stop(t + dur);
  }

  tone({ dur = 0.1, from = 600, to = 600, gain = 0.08, type = 'sine' }) {
    if (!this.enabled || !this.ensure()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  }

  shot() { this.burst({ dur: 0.07, freq: 1400, gain: 0.18 }); }
  enemyShot() { this.burst({ dur: 0.09, freq: 700, gain: 0.09 }); }
  explosion() {
    this.burst({ dur: 0.6, freq: 240, gain: 0.5 });
    this.tone({ dur: 0.5, from: 120, to: 30, gain: 0.25, type: 'triangle' });
  }
  hit() { this.tone({ dur: 0.05, from: 1100, to: 700, gain: 0.06, type: 'square' }); }
  click() { this.tone({ dur: 0.04, from: 1600, to: 1200, gain: 0.05, type: 'square' }); }
  cash() {
    this.tone({ dur: 0.12, from: 880, to: 1320, gain: 0.1 });
    setTimeout(() => this.tone({ dur: 0.2, from: 1320, to: 1760, gain: 0.1 }), 110);
  }
  alarm() { this.tone({ dur: 0.35, from: 500, to: 220, gain: 0.12, type: 'sawtooth' }); }
  step() { this.tone({ dur: 0.1, from: 660, to: 990, gain: 0.07 }); }
}

export const sound = new SoundEngine();
