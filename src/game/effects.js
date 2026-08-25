// Visual effects (tracers, flashes, explosions) and synthesized audio.

import * as THREE from 'three';

// ------------------------------------------------- particle sprite sheets
//
// Small canvas textures give every effect soft, detailed falloff instead of
// hard geometric shapes — lumpy smoke, hot fire cores, starburst flashes.

function smokeTexture() {
  const N = 96;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d');
  // lumpy blob: several soft circles jittered around the center
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const r = i === 0 ? 0 : 12 + Math.random() * 10;
    const x = N / 2 + Math.cos(a) * r, y = N / 2 + Math.sin(a) * r;
    const rad = i === 0 ? 30 : 14 + Math.random() * 10;
    const g = ctx.createRadialGradient(x, y, 1, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, N, N);
  }
  return new THREE.CanvasTexture(c);
}

function fireTexture() {
  const N = 64;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(N / 2, N / 2, 2, N / 2, N / 2, N / 2);
  g.addColorStop(0, 'rgba(255,255,240,1)');
  g.addColorStop(0.25, 'rgba(255,220,130,0.95)');
  g.addColorStop(0.55, 'rgba(255,140,50,0.7)');
  g.addColorStop(0.85, 'rgba(180,60,20,0.25)');
  g.addColorStop(1, 'rgba(120,40,10,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, N, N);
  return new THREE.CanvasTexture(c);
}

function flashTexture() {
  const N = 64;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(N / 2, N / 2, 1, N / 2, N / 2, 16);
  g.addColorStop(0, 'rgba(255,255,245,1)');
  g.addColorStop(1, 'rgba(255,210,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, N, N);
  // starburst spikes
  ctx.strokeStyle = 'rgba(255,230,160,0.8)';
  ctx.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    const len = 18 + Math.random() * 12;
    ctx.lineWidth = 2.2 - i * 0.1;
    ctx.beginPath();
    ctx.moveTo(N / 2, N / 2);
    ctx.lineTo(N / 2 + Math.cos(a) * len, N / 2 + Math.sin(a) * len);
    ctx.stroke();
  }
  return new THREE.CanvasTexture(c);
}

function scorchTexture() {
  const N = 96;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(N / 2, N / 2, 4, N / 2, N / 2, N / 2);
  g.addColorStop(0, 'rgba(8,6,4,0.9)');
  g.addColorStop(0.55, 'rgba(14,11,8,0.6)');
  g.addColorStop(1, 'rgba(20,16,10,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, N, N);
  // ragged edge: soot streaks radiating out
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    ctx.strokeStyle = 'rgba(10,8,6,0.5)';
    ctx.lineWidth = 2 + Math.random() * 4;
    ctx.beginPath();
    ctx.moveTo(N / 2 + Math.cos(a) * 18, N / 2 + Math.sin(a) * 18);
    ctx.lineTo(N / 2 + Math.cos(a) * (34 + Math.random() * 12), N / 2 + Math.sin(a) * (34 + Math.random() * 12));
    ctx.stroke();
  }
  return new THREE.CanvasTexture(c);
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.items = []; // { mesh, life, ttl, update(item, dt), vel?, ... }
    this.tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    this.chipGeo = new THREE.TetrahedronGeometry(0.04);
    this.chipGeoBig = new THREE.TetrahedronGeometry(0.08);
    this.sparkGeo = new THREE.BoxGeometry(0.025, 0.025, 0.4);
    this.smokeTex = smokeTexture();
    this.fireTex = fireTexture();
    this.flashTex = flashTexture();
    this.scorchTex = scorchTexture();
  }

  _sprite(tex, color, opacity, { additive = false, rotation = 0 } = {}) {
    return new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color, transparent: true, opacity, rotation,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false
    }));
  }

  _add(mesh, ttl, update) {
    this.scene.add(mesh);
    const it = { mesh, life: 0, ttl, update };
    this.items.push(it);
    return it;
  }

  // hot white core + wider additive glow, so rounds read as streaks of light
  tracer(from, to, friendly = true) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 0.01) return;
    const mid = from.clone().addScaledVector(dir, 0.5);
    const core = new THREE.Mesh(this.tracerGeo, new THREE.MeshBasicMaterial({
      color: 0xfff6d8, transparent: true, depthWrite: false
    }));
    core.scale.set(0.02, 0.02, len);
    core.position.copy(mid);
    core.lookAt(to);
    this._add(core, 0.08, (it) => { it.mesh.material.opacity = 1 - it.life / it.ttl; });
    const glow = new THREE.Mesh(this.tracerGeo, new THREE.MeshBasicMaterial({
      color: friendly ? 0xffd27a : 0xff7a4a, transparent: true, opacity: 0.45,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    glow.scale.set(0.09, 0.09, len);
    glow.position.copy(mid);
    glow.lookAt(to);
    this._add(glow, 0.08, (it) => { it.mesh.material.opacity = 0.45 * (1 - it.life / it.ttl); });
  }

  muzzleFlash(pos, dir) {
    const star = this._sprite(this.flashTex, 0xffeecc, 1, {
      additive: true, rotation: Math.random() * Math.PI * 2
    });
    star.position.copy(pos).addScaledVector(dir, 0.14);
    star.scale.setScalar(0.34 + Math.random() * 0.14);
    this._add(star, 0.05, (it) => {
      it.mesh.material.opacity = 1 - it.life / it.ttl;
      it.mesh.scale.setScalar(it.mesh.scale.x * 1.06);
    });
    // faint smoke wisp drifting off the barrel (sparingly — lots of shots)
    if (Math.random() < 0.35) {
      const wisp = this._sprite(this.smokeTex, 0x9a958c, 0.28);
      wisp.position.copy(pos).addScaledVector(dir, 0.22);
      wisp.scale.setScalar(0.16);
      this._add(wisp, 0.5, (it, dt) => {
        it.mesh.position.y += dt * 0.4;
        it.mesh.scale.setScalar(it.mesh.scale.x + dt * 0.8);
        it.mesh.material.opacity = 0.28 * (1 - it.life / it.ttl);
      });
    }
  }

  // round striking a hard surface: spark flash + dust puffs + stone chips
  impact(pos, tint = 0xb8a58a) {
    const flash = this._sprite(this.flashTex, 0xffdca0, 0.9, {
      additive: true, rotation: Math.random() * Math.PI * 2
    });
    flash.position.copy(pos);
    flash.scale.setScalar(0.22);
    this._add(flash, 0.05, (it) => { it.mesh.material.opacity = 0.9 * (1 - it.life / it.ttl); });
    for (let i = 0; i < 2; i++) {
      const puff = this._sprite(this.smokeTex, tint, 0.55);
      puff.position.copy(pos).add(new THREE.Vector3(
        (Math.random() - 0.5) * 0.12, Math.random() * 0.1, (Math.random() - 0.5) * 0.12
      ));
      puff.scale.setScalar(0.3 + Math.random() * 0.15);
      this._add(puff, 0.45 + Math.random() * 0.2, (it, dt) => {
        it.mesh.position.y += dt * 0.55;
        it.mesh.scale.setScalar(it.mesh.scale.x + dt * 2.2);
        it.mesh.material.opacity = 0.65 * (1 - it.life / it.ttl);
      });
    }
    for (let i = 0; i < 4; i++) {
      const chip = new THREE.Mesh(this.chipGeo, new THREE.MeshBasicMaterial({
        color: 0x54493a, transparent: true
      }));
      chip.position.copy(pos);
      const it = this._add(chip, 0.45, (it2, dt) => {
        it2.vel.y -= dt * 9.5;
        it2.mesh.position.addScaledVector(it2.vel, dt);
        it2.mesh.rotation.x += dt * 12;
        it2.mesh.rotation.z += dt * 9;
        it2.mesh.material.opacity = 1 - (it2.life / it2.ttl) ** 2;
      });
      it.vel = new THREE.Vector3(
        (Math.random() - 0.5) * 3.2, 1.2 + Math.random() * 2.4, (Math.random() - 0.5) * 3.2
      );
    }
  }

  explosion(pos) {
    // blinding core flash
    const flash = this._sprite(this.flashTex, 0xffffff, 1, {
      additive: true, rotation: Math.random() * Math.PI * 2
    });
    flash.position.copy(pos);
    flash.scale.setScalar(3.2);
    this._add(flash, 0.12, (it) => {
      it.mesh.material.opacity = 1 - it.life / it.ttl;
      it.mesh.scale.setScalar(it.mesh.scale.x * 1.08);
    });
    // rolling fireball: hot sprites that rise, swell and cool
    for (let i = 0; i < 6; i++) {
      const fire = this._sprite(this.fireTex, 0xffd8a0, 0.95, {
        additive: true, rotation: Math.random() * Math.PI * 2
      });
      fire.position.copy(pos).add(new THREE.Vector3(
        (Math.random() - 0.5) * 0.8, Math.random() * 0.5, (Math.random() - 0.5) * 0.8
      ));
      fire.scale.setScalar(0.9 + Math.random() * 0.9);
      const it = this._add(fire, 0.24 + Math.random() * 0.16, (it2, dt) => {
        const t = it2.life / it2.ttl;
        it2.mesh.position.addScaledVector(it2.vel, dt);
        it2.mesh.scale.setScalar(Math.min(2.4, it2.mesh.scale.x + dt * 2.4));
        it2.mesh.material.opacity = 0.95 * (1 - t) ** 1.6;
        it2.mesh.material.color.setHSL(0.075 - t * 0.05, 1, 0.62 - t * 0.3);
      });
      it.vel = new THREE.Vector3((Math.random() - 0.5) * 1.4, 1.4 + Math.random() * 1.6, (Math.random() - 0.5) * 1.4);
    }
    // churning smoke column that lingers after the fire dies
    for (let i = 0; i < 7; i++) {
      const shade = 0.16 + Math.random() * 0.14;
      const smoke = this._sprite(this.smokeTex, new THREE.Color(shade, shade * 0.96, shade * 0.9), 0, {
        rotation: Math.random() * Math.PI * 2
      });
      smoke.position.copy(pos).add(new THREE.Vector3(
        (Math.random() - 0.5) * 1.2, 0.3 + Math.random() * 0.8, (Math.random() - 0.5) * 1.2
      ));
      smoke.scale.setScalar(1.2 + Math.random() * 1.0);
      const it = this._add(smoke, 1.5 + Math.random() * 0.9, (it2, dt) => {
        const t = it2.life / it2.ttl;
        it2.mesh.position.addScaledVector(it2.vel, dt);
        it2.mesh.scale.setScalar(it2.mesh.scale.x + dt * 1.9);
        it2.mesh.material.opacity = 0.7 * Math.min(1, t / 0.15) * (1 - t);
        it2.mesh.material.rotation += dt * it2.spin;
      });
      it.vel = new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.9 + Math.random() * 0.9, (Math.random() - 0.5) * 0.8);
      it.spin = (Math.random() - 0.5) * 1.2;
    }
    // white-hot sparks streaking out ballistically
    for (let i = 0; i < 9; i++) {
      const spark = new THREE.Mesh(this.sparkGeo, new THREE.MeshBasicMaterial({
        color: 0xffdf9a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
      }));
      spark.position.copy(pos);
      const it = this._add(spark, 0.3 + Math.random() * 0.18, (it2, dt) => {
        it2.vel.y -= dt * 14;
        it2.mesh.position.addScaledVector(it2.vel, dt);
        it2.mesh.lookAt(it2.mesh.position.clone().add(it2.vel));
        it2.mesh.material.opacity = 1 - it2.life / it2.ttl;
      });
      const a = Math.random() * Math.PI * 2;
      const up = 2.5 + Math.random() * 6.5;
      const out = 3.5 + Math.random() * 5.5;
      it.vel = new THREE.Vector3(Math.cos(a) * out, up, Math.sin(a) * out);
    }
    // tumbling debris chunks
    for (let i = 0; i < 8; i++) {
      const chunk = new THREE.Mesh(this.chipGeoBig, new THREE.MeshBasicMaterial({
        color: 0x3c352c, transparent: true
      }));
      chunk.position.copy(pos);
      const it = this._add(chunk, 0.8 + Math.random() * 0.35, (it2, dt) => {
        it2.vel.y -= dt * 10;
        it2.mesh.position.addScaledVector(it2.vel, dt);
        if (it2.mesh.position.y < 0.04) { it2.mesh.position.y = 0.04; it2.vel.set(0, 0, 0); }
        it2.mesh.rotation.x += dt * 9;
        it2.mesh.rotation.y += dt * 7;
        it2.mesh.material.opacity = 1 - (it2.life / it2.ttl) ** 3;
      });
      const a = Math.random() * Math.PI * 2;
      const out = 2 + Math.random() * 4.5;
      it.vel = new THREE.Vector3(Math.cos(a) * out, 2.5 + Math.random() * 4, Math.sin(a) * out);
    }
    // ground shockwave + lingering scorch
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 26),
      new THREE.MeshBasicMaterial({
        color: 0xffe0b0, transparent: true, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    ring.position.copy(pos).setY(Math.max(0.12, pos.y - 0.8));
    ring.rotation.x = -Math.PI / 2;
    this._add(ring, 0.4, (it) => {
      const t = it.life / it.ttl;
      it.mesh.scale.setScalar(0.4 + t * 9);
      it.mesh.material.opacity = 0.75 * (1 - t);
    });
    if (pos.y < 2.2) {
      const scorch = new THREE.Mesh(
        new THREE.CircleGeometry(1.5, 20),
        new THREE.MeshBasicMaterial({
          map: this.scorchTex, transparent: true, opacity: 0.85, depthWrite: false
        })
      );
      scorch.position.set(pos.x, 0.04, pos.z);
      scorch.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
      this._add(scorch, 7, (it) => {
        const t = it.life / it.ttl;
        it.mesh.material.opacity = 0.85 * (t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4);
      });
    }
  }

  // blinding white burst for flashbang rounds
  flashBang(pos) {
    const core = this._sprite(this.flashTex, 0xffffff, 1, { additive: true });
    core.position.copy(pos);
    core.scale.setScalar(2.4);
    this._add(core, 0.5, (it) => {
      const t = it.life / it.ttl;
      it.mesh.scale.setScalar(it.mesh.scale.x + it.ttl * 26 * (it.ttl - it.life));
      it.mesh.material.opacity = 1 - t * t;
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    ring.position.copy(pos);
    ring.rotation.x = -Math.PI / 2;
    this._add(ring, 0.4, (it) => {
      const t = it.life / it.ttl;
      it.mesh.scale.setScalar(0.5 + t * 10);
      it.mesh.material.opacity = 0.8 * (1 - t);
    });
    const haze = this._sprite(this.smokeTex, 0xf2f2ee, 0.5);
    haze.position.copy(pos);
    haze.scale.setScalar(1.4);
    this._add(haze, 1.1, (it, dt) => {
      it.mesh.position.y += dt * 0.5;
      it.mesh.scale.setScalar(it.mesh.scale.x + dt * 2.2);
      it.mesh.material.opacity = 0.5 * (1 - it.life / it.ttl);
    });
  }

  smokePuff(pos) {
    const puff = this._sprite(this.smokeTex, 0xb2b5ae, 0.45, {
      rotation: Math.random() * Math.PI * 2
    });
    puff.position.copy(pos);
    puff.scale.setScalar(0.3);
    this._add(puff, 0.8, (it, dt) => {
      it.mesh.position.y += dt * 0.55;
      it.mesh.scale.setScalar(it.mesh.scale.x + dt * 1.5);
      it.mesh.material.opacity = 0.45 * (1 - it.life / it.ttl);
    });
  }

  // Floating cash bounty: clean glowing green "+$X.XX" with no backing
  // plate, drifting up and fading — the betting game keeping score in the
  // world. Rendered through walls (depthTest off) so a comrade's kill
  // around a corner still visibly rings the register.
  cashPop(pos, text) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    const font = '700 64px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width);
    c.width = w + 64;
    c.height = 128;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // dark understroke for contrast on bright walls, then saturated green
    // glyphs under a soft green bloom
    ctx.lineWidth = 9;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(5,38,16,0.9)';
    ctx.strokeText(text, c.width / 2, 64);
    ctx.shadowColor = 'rgba(40,255,110,0.9)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#31e868';
    ctx.fillText(text, c.width / 2, 64);
    ctx.fillText(text, c.width / 2, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0, depthWrite: false, depthTest: false
    }));
    spr.renderOrder = 450; // over the world, under the first-person arms
    spr.position.copy(pos);
    const h = 0.5;
    const aspect = c.width / c.height;
    this._add(spr, 1.5, (it, dt) => {
      const k = it.life / it.ttl;
      it.mesh.position.y += dt * (0.55 - k * 0.3); // rises, easing off
      // perspective-compensated beyond ~7m so a comrade's kill across the
      // compound still reads, and a slight swell over its life
      const dist = this.camera ? this.camera.position.distanceTo(it.mesh.position) : 7;
      const s = h * Math.max(1, dist / 7) * (1 + k * 0.12);
      it.mesh.scale.set(s * aspect, s, 1);
      // snap in, hold, then a long fade
      it.mesh.material.opacity = k < 0.08 ? k / 0.08 : k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45;
      if (it.life + dt >= it.ttl) it.mesh.material.map?.dispose?.();
    });
  }

  // round connecting with a body: brief flash + red mist
  hitSpark(pos) {
    const flash = this._sprite(this.flashTex, 0xffb090, 0.85, {
      additive: true, rotation: Math.random() * Math.PI * 2
    });
    flash.position.copy(pos);
    flash.scale.setScalar(0.2);
    this._add(flash, 0.06, (it) => { it.mesh.material.opacity = 0.85 * (1 - it.life / it.ttl); });
    const mist = this._sprite(this.smokeTex, 0x7c1d14, 0.6, {
      rotation: Math.random() * Math.PI * 2
    });
    mist.position.copy(pos);
    mist.scale.setScalar(0.28);
    this._add(mist, 0.35, (it, dt) => {
      it.mesh.position.y -= dt * 0.25;
      it.mesh.scale.setScalar(it.mesh.scale.x + dt * 1.7);
      it.mesh.material.opacity = 0.6 * (1 - it.life / it.ttl);
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
