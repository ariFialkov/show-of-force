import './style.css';
import { GAME } from './config.js';
import { generateMission } from './missions.js';
import { drawRound, fmtMoney } from './rtp.js';
import { wallet } from './wallet.js';
import { Game } from './game/game.js';
import { IS_TOUCH } from './game/controls.js';
import { sound } from './game/effects.js';
import * as ui from './ui.js';

if (IS_TOUCH) document.body.classList.add('touch-mode');

const game = new Game(document.getElementById('gl'), {
  touchLayer: ui.els.touchLayer,
  joyL: ui.els.joyL,
  joyR: ui.els.joyR,
  btnFire: ui.els.btnFire,
  btnFrag: ui.els.btnFrag
});

// debugging hook (harmless in production; used by automated smoke tests)
window.__game = game;

// unlock audio on first interaction
game.controls.onFirstInteract = () => sound.ensure();
document.addEventListener('pointerdown', () => sound.ensure(), { once: true });

// ----------------------------------------------------------------- state

let mission = null;
let bet = 10;
let inLobby = false;
let rotationStart = 0;
let rotationTimer = null;
let rosterTimer = null;

// ----------------------------------------------------------------- lobby

function enterLobby() {
  inLobby = true;
  ui.showHud(false);
  ui.setScoped(false);
  ui.showLobby(true);
  ui.setBalance(wallet.balance);
  ui.fade(false);
  rotateLobby();
}

function rotateLobby() {
  clearTimeout(rotationTimer);
  clearInterval(rosterTimer);
  mission = generateMission();
  game.setMission(mission);
  ui.renderLobbyMission(mission);
  rotationStart = performance.now();

  // staggered fake joins — only re-render when the joined count changes,
  // so rows don't re-animate/flash on every tick
  let lastJoined = -1;
  const renderRoster = () => {
    const t = performance.now() - rotationStart;
    const joined = mission.roster.filter((b) => t >= b.joinDelay).length;
    if (joined !== lastJoined) {
      lastJoined = joined;
      ui.renderRoster(mission, joined, false);
    }
  };
  renderRoster();
  rosterTimer = setInterval(renderRoster, 400);

  rotationTimer = setTimeout(() => {
    if (inLobby) rotateLobby();
  }, GAME.lobbyRotateMs);
}

// countdown ring
setInterval(() => {
  if (!inLobby) return;
  const left = GAME.lobbyRotateMs - (performance.now() - rotationStart);
  ui.setLobbyCountdown(left, GAME.lobbyRotateMs);
}, 120);

// ----------------------------------------------------------------- bets

function clampBet(v) {
  return Math.min(GAME.maxBet, Math.max(GAME.minBet, Math.round(v)));
}

function renderBet() {
  ui.els.betAmt.textContent = fmtMoney(bet);
  ui.els.deploy.disabled = wallet.balance < bet;
}

ui.els.betMinus.addEventListener('click', () => { bet = clampBet(bet - 5); renderBet(); sound.click(); });
ui.els.betPlus.addEventListener('click', () => { bet = clampBet(bet + 5); renderBet(); sound.click(); });
for (const v of GAME.betChips) {
  const b = document.createElement('button');
  b.className = 'chip';
  b.textContent = `$${v}`;
  b.addEventListener('click', () => { bet = clampBet(v); renderBet(); sound.click(); });
  ui.els.betChips.appendChild(b);
}
renderBet();

// ----------------------------------------------------------------- deploy

ui.els.deploy.addEventListener('click', () => {
  if (!inLobby || wallet.balance < bet) return;
  inLobby = false;
  clearTimeout(rotationTimer);
  clearInterval(rosterTimer);
  sound.click();

  wallet.debit(bet);
  ui.setBalance(wallet.balance);
  ui.renderRoster(mission, mission.roster.length, true);

  // squad-locked countdown, then insertion
  ui.els.deployingTitle.textContent = `${mission.opName} — ${mission.location.name}`;
  ui.els.deploying.classList.remove('hidden');
  let n = 3;
  ui.els.deployingCount.textContent = n;
  const tick = setInterval(() => {
    n--;
    if (n > 0) {
      ui.els.deployingCount.textContent = n;
      sound.click();
    } else {
      clearInterval(tick);
      ui.els.deploying.classList.add('hidden');
      ui.showLobby(false);
      startRound();
    }
  }, 900);
});

function startRound() {
  const plan = drawRound(makeCryptoRng());
  ui.buildStepDots();
  ui.setStep(1);
  ui.setPot(0, bet * plan.mults[0]);
  ui.setKills(0);
  ui.setAmmo(30, false);
  ui.setHealth(100);
  game.startRound({ bet, plan });
}

// Round outcomes must not depend on the map seed — draw from fresh entropy.
function makeCryptoRng() {
  return {
    chance: (p) => {
      const u32 = crypto.getRandomValues(new Uint32Array(1))[0];
      return u32 / 4294967296 < p;
    }
  };
}

// ----------------------------------------------------------------- game wiring

game.cb.onDismount = () => {
  ui.showHud(true);
  ui.typewriterTitle(`${mission.subtype.toUpperCase()} — ${mission.location.name.toUpperCase()}`);
  if (!IS_TOUCH) ui.flashMsg('CLICK TO TAKE CONTROL — WASD MOVE · RMB SCOPE · SPACE FRAG', 4200);
  else ui.flashMsg('LEFT: AIM (2× TAP = SCOPE) · RIGHT: MOVE', 4200);
};

game.cb.onSegmentStart = (step) => {
  ui.setStep(step);
  if (step > 1) ui.flashMsg(`CHECKPOINT ${step} — PUSH FORWARD`);
};

game.cb.onPot = (pot, next) => ui.setPot(pot, next);
game.cb.onKill = (k) => ui.setKills(k);
game.cb.onAmmo = (a, reloading) => ui.setAmmo(a, reloading);
game.cb.onHealth = (h) => ui.setHealth(h);
game.cb.onScope = (v) => ui.setScoped(v);

game.cb.onDecision = (step, pot) => {
  const flavor = mission.decisions[step - 1] ?? ['Push forward', 'Flank around'];
  ui.showDecision({
    step,
    maxSteps: GAME.maxSteps,
    pot,
    nextMult: game.round.plan.mults[step], // multiplier if the next step survives
    optionA: flavor[0],
    optionB: flavor[1],
    cashAmount: pot,
    canCash: game.round.plan.mults[step - 1] >= 1
  }, {
    onContinue: (which) => {
      sound.click();
      ui.flashMsg(which === 'a' ? `ROGER — ${flavor[0].toUpperCase()}` : `ROGER — ${flavor[1].toUpperCase()}`);
      game.resumeAfterDecision();
    },
    onCashOut: () => {
      game.cashOut(); // fires onRoundEnd
    }
  });
};

game.cb.onRoundEnd = ({ result, payout, step, kills }) => {
  if (payout > 0) wallet.credit(payout);
  setTimeout(() => {
    ui.fade(true);
    setTimeout(() => {
      ui.showHud(false);
      ui.setHealth(100);
      ui.showResult({ result, payout, step, kills, bet }, () => {
        enterLobby();
      });
      ui.fade(false);
    }, 650);
  }, result === 'kia' ? 400 : 700);
};

// ----------------------------------------------------------------- boot

ui.buildStepDots();
enterLobby();

// PWA service worker
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
