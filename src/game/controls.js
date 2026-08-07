// Unified input.
//
// Desktop: WASD move, mouse-look (pointer lock), left-click fire,
//          space frag, right-click toggles scope.
// Mobile:  static LEFT joystick = move; swipe/drag anywhere else = look;
//          FIRE / FRAG buttons; double-tap the look area toggles scope.

export const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

const MOUSE_SENS = 0.0023;
const LOOK_DRAG_SENS = 0.0044; // rad per px of swipe
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
    this.onWeaponSwitch = null;

    this.keys = new Set();
    this.lookPointer = null; // { id, lx, ly }
    this.movePointer = null;
    this.lastLookTap = 0;

    this._bind();
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
    this.lookPointer = null;
    this.movePointer = null;
    this._resetKnob();
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
      if (e.code === 'KeyN' && !e.repeat) {
        this.onWeaponSwitch?.();
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

      // static move joystick zone (bottom-left)
      const joyRect = this.ui.joyL.getBoundingClientRect();
      const jcx = joyRect.left + joyRect.width / 2;
      const jcy = joyRect.top + joyRect.height / 2;
      const inJoy = Math.hypot(e.clientX - jcx, e.clientY - jcy) < Math.max(70, joyRect.width * 0.8);

      if (inJoy && !this.movePointer) {
        this.movePointer = { id: e.pointerId, cx: jcx, cy: jcy };
        this._applyMove(e.clientX, e.clientY);
      } else if (!this.lookPointer) {
        // swipe-to-look anywhere else; double-tap toggles scope
        const now = performance.now();
        if (now - this.lastLookTap < 300) {
          this.setScoped(!this.scoped);
          this.lastLookTap = 0;
        } else {
          this.lastLookTap = now;
        }
        this.lookPointer = { id: e.pointerId, lx: e.clientX, ly: e.clientY };
      }
    });

    layer.addEventListener('pointermove', (e) => {
      if (this.movePointer && e.pointerId === this.movePointer.id) {
        this._applyMove(e.clientX, e.clientY);
      } else if (this.lookPointer && e.pointerId === this.lookPointer.id) {
        const sens = LOOK_DRAG_SENS * (this.scoped ? 0.45 : 1);
        this.yaw -= (e.clientX - this.lookPointer.lx) * sens;
        this.pitch = clamp(this.pitch - (e.clientY - this.lookPointer.ly) * sens, -1.35, 1.35);
        this.lookPointer.lx = e.clientX;
        this.lookPointer.ly = e.clientY;
      }
    });

    const endPointer = (e) => {
      if (this.lookPointer && e.pointerId === this.lookPointer.id) {
        this.lookPointer = null;
      }
      if (this.movePointer && e.pointerId === this.movePointer.id) {
        this.movePointer = null;
        this.move.x = 0; this.move.z = 0;
        this._resetKnob();
      }
    };
    layer.addEventListener('pointerup', endPointer);
    layer.addEventListener('pointercancel', endPointer);

    // fire / frag buttons — holding FIRE for ~0.8s switches weapons
    const fire = this.ui.btnFire;
    const hold = (e) => {
      e.preventDefault();
      this.onFirstInteract?.();
      if (!this.enabled) return;
      this.firing = true;
      clearTimeout(this._fireHoldTimer);
      this._fireHoldTimer = setTimeout(() => {
        if (this.firing) {
          this.firing = false;
          this.onWeaponSwitch?.();
        }
      }, 800);
    };
    const release = (e) => {
      e.preventDefault();
      this.firing = false;
      clearTimeout(this._fireHoldTimer);
    };
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

  _applyMove(px, py) {
    const p = this.movePointer;
    const dx = px - p.cx, dy = py - p.cy;
    const len = Math.hypot(dx, dy);
    const capped = Math.min(len, JOY_RADIUS);
    const kx = len > 0 ? (dx / len) * capped : 0;
    const ky = len > 0 ? (dy / len) * capped : 0;
    this.ui.joyL.querySelector('.joy-knob').style.transform =
      `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
    this.move.x = clamp(dx / JOY_RADIUS, -1, 1);
    this.move.z = clamp(-dy / JOY_RADIUS, -1, 1);
  }

  _resetKnob() {
    const knob = this.ui.joyL?.querySelector('.joy-knob');
    if (knob) knob.style.transform = 'translate(-50%,-50%)';
  }
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
