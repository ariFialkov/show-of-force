// Unified input.
//
// Desktop: WASD move, mouse-look (pointer lock), left-click fire,
//          space frag, right-click toggles scope.
// Mobile:  LEFT dynamic joystick = aim, RIGHT dynamic joystick = move,
//          FIRE / FRAG buttons, double-tap on the aim side toggles scope.

export const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

const AIM_JOY_SPEED = 3.2;     // rad/s at full deflection
const MOUSE_SENS = 0.0023;
const JOY_RADIUS = 56;         // px, full deflection

export class Controls {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.ui = ui; // { touchLayer, joyL, joyR, btnFire, btnFrag }
    this.enabled = false;

    this.yaw = 0;
    this.pitch = 0;
    this.move = { x: 0, z: 0 };   // local: x = strafe right, z = forward
    this.firing = false;
    this.scoped = false;

    this.onFrag = null;
    this.onScopeChange = null;
    this.onFirstInteract = null;

    this.keys = new Set();
    this.aimPointer = null;  // { id, ox, oy, dx, dy }
    this.movePointer = null;
    this.lastLeftTap = 0;

    this._bind();
  }

  get aimRate() {
    // rad/s applied by game.update for touch aim
    if (!this.aimPointer) return { yaw: 0, pitch: 0 };
    const sens = this.scoped ? 0.45 : 1;
    const nx = clamp(this.aimPointer.dx / JOY_RADIUS, -1, 1);
    const ny = clamp(this.aimPointer.dy / JOY_RADIUS, -1, 1);
    return { yaw: -nx * AIM_JOY_SPEED * sens, pitch: -ny * AIM_JOY_SPEED * 0.7 * sens };
  }

  setScoped(v) {
    if (this.scoped === v) return;
    this.scoped = v;
    this.onScopeChange?.(v);
  }

  enable() { this.enabled = true; }

  disable() {
    this.enabled = false;
    this.firing = false;
    this.move.x = 0; this.move.z = 0;
    this.keys.clear();
    this.aimPointer = null;
    this.movePointer = null;
    this._hideJoy(this.ui.joyL);
    this._hideJoy(this.ui.joyR);
    this.setScoped(false);
  }

  requestPointerLock() {
    if (!IS_TOUCH && document.pointerLockElement !== this.canvas) {
      try {
        const p = this.canvas.requestPointerLock?.();
        p?.catch?.(() => {});
      } catch { /* pointer lock unsupported/denied */ }
    }
  }

  _bind() {
    // ---------------- desktop
    document.addEventListener('keydown', (e) => {
      if (!this.enabled || IS_TOUCH) return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.onFrag?.();
        return;
      }
      this.keys.add(e.code);
      this._recomputeKeyMove();
    });
    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this._recomputeKeyMove();
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || IS_TOUCH) return;
      if (document.pointerLockElement !== this.canvas) return;
      const sens = MOUSE_SENS * (this.scoped ? 0.45 : 1);
      this.yaw -= e.movementX * sens;
      this.pitch = clamp(this.pitch - e.movementY * sens, -1.35, 1.35);
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (IS_TOUCH) return;
      this.onFirstInteract?.();
      if (!this.enabled) return;
      if (document.pointerLockElement !== this.canvas) {
        this.requestPointerLock();
        return;
      }
      if (e.button === 0) this.firing = true;
      if (e.button === 2) this.setScoped(!this.scoped);
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // ---------------- touch
    const layer = this.ui.touchLayer;
    layer.addEventListener('pointerdown', (e) => {
      if (!IS_TOUCH || e.pointerType === 'mouse') return;
      if (e.target.closest?.('.combat-btn')) return; // buttons handle themselves
      this.onFirstInteract?.();
      if (!this.enabled) return;
      const half = window.innerWidth / 2;
      if (e.clientX < half) {
        // aim side + double-tap scope
        const now = performance.now();
        if (now - this.lastLeftTap < 300) {
          this.setScoped(!this.scoped);
          this.lastLeftTap = 0;
        } else {
          this.lastLeftTap = now;
        }
        if (!this.aimPointer) {
          this.aimPointer = { id: e.pointerId, ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 };
          this._showJoy(this.ui.joyL, e.clientX, e.clientY);
        }
      } else {
        if (!this.movePointer) {
          this.movePointer = { id: e.pointerId, ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 };
          this._showJoy(this.ui.joyR, e.clientX, e.clientY);
        }
      }
    });

    layer.addEventListener('pointermove', (e) => {
      if (this.aimPointer && e.pointerId === this.aimPointer.id) {
        this.aimPointer.dx = e.clientX - this.aimPointer.ox;
        this.aimPointer.dy = e.clientY - this.aimPointer.oy;
        this._moveKnob(this.ui.joyL, this.aimPointer);
      } else if (this.movePointer && e.pointerId === this.movePointer.id) {
        this.movePointer.dx = e.clientX - this.movePointer.ox;
        this.movePointer.dy = e.clientY - this.movePointer.oy;
        this._moveKnob(this.ui.joyR, this.movePointer);
        const nx = clamp(this.movePointer.dx / JOY_RADIUS, -1, 1);
        const ny = clamp(this.movePointer.dy / JOY_RADIUS, -1, 1);
        this.move.x = nx;
        this.move.z = -ny;
      }
    });

    const endPointer = (e) => {
      if (this.aimPointer && e.pointerId === this.aimPointer.id) {
        this.aimPointer = null;
        this._hideJoy(this.ui.joyL);
      }
      if (this.movePointer && e.pointerId === this.movePointer.id) {
        this.movePointer = null;
        this.move.x = 0; this.move.z = 0;
        this._hideJoy(this.ui.joyR);
      }
    };
    layer.addEventListener('pointerup', endPointer);
    layer.addEventListener('pointercancel', endPointer);

    // fire / frag buttons
    const fire = this.ui.btnFire;
    const hold = (e) => { e.preventDefault(); this.onFirstInteract?.(); if (this.enabled) this.firing = true; };
    const release = (e) => { e.preventDefault(); this.firing = false; };
    fire.addEventListener('pointerdown', hold);
    fire.addEventListener('pointerup', release);
    fire.addEventListener('pointercancel', release);
    fire.addEventListener('pointerleave', release);

    this.ui.btnFrag.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.onFirstInteract?.();
      if (this.enabled) this.onFrag?.();
    });
  }

  _recomputeKeyMove() {
    if (IS_TOUCH) return;
    let x = 0, z = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) z += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) z -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    const len = Math.hypot(x, z) || 1;
    this.move.x = x / len;
    this.move.z = z / len;
  }

  _showJoy(el, x, y) {
    el.style.display = 'block';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.querySelector('.joy-knob').style.transform = 'translate(-50%,-50%)';
  }

  _moveKnob(el, p) {
    const len = Math.hypot(p.dx, p.dy);
    const capped = Math.min(len, JOY_RADIUS);
    const kx = len > 0 ? (p.dx / len) * capped : 0;
    const ky = len > 0 ? (p.dy / len) * capped : 0;
    el.querySelector('.joy-knob').style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
  }

  _hideJoy(el) {
    el.style.display = 'none';
  }
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
