// DOM/HUD layer: lobby screen, HUD, decision overlay, result screen,
// typewriter mission title.

import { GAME } from './config.js';
import { fmtMoney, fmtMult } from './rtp.js';

const $ = (id) => document.getElementById(id);

export const els = {
  hud: $('hud'), pot: $('hud-pot'), next: $('hud-next'), steps: $('hud-steps'),
  kills: $('hud-kills'), ammo: $('hud-ammo'), msg: $('hud-msg'), crosshair: $('crosshair'),
  scope: $('scope-overlay'), damage: $('damage-flash'), fade: $('fade'),
  title: $('mission-title'), titleText: $('mission-title-text'),
  decision: $('decision'), decisionKicker: $('decision-kicker'),
  decisionPot: $('decision-pot'), decisionNext: $('decision-next'),
  decisionA: $('decision-a'), decisionB: $('decision-b'),
  decisionCash: $('decision-cash'), decisionCashAmt: $('decision-cash-amt'),
  result: $('result'), resultHeadline: $('result-headline'), resultSub: $('result-sub'),
  resultPayout: $('result-payout'), resultStats: $('result-stats'), resultContinue: $('result-continue'),
  lobby: $('lobby'), lobbyId: $('lobby-id'), lobbyOp: $('lobby-op'),
  lobbyMission: $('lobby-mission'), lobbyBlurb: $('lobby-blurb'),
  lobbyEmblem: $('lobby-emblem'), lobbyTeam: $('lobby-team'), lobbyBranch: $('lobby-branch'),
  lobbyRoster: $('lobby-roster'), lobbyBalance: $('lobby-balance-amt'),
  lobbyRing: $('lobby-ring'), lobbyRotationS: $('lobby-rotation-s'),
  betAmt: $('bet-amt'), betMinus: $('bet-minus'), betPlus: $('bet-plus'), betChips: $('bet-chips'),
  deploy: $('btn-deploy'), deploying: $('deploying'), deployingCount: $('deploying-count'),
  deployingTitle: $('deploying-title'),
  touchLayer: $('touch-layer'), joyL: $('joy-left'), joyR: $('joy-right'),
  btnFire: $('btn-fire'), btnFrag: $('btn-frag')
};

// ------------------------------------------------------------------- HUD

export function buildStepDots() {
  els.steps.innerHTML = '';
  for (let i = 0; i < GAME.maxSteps; i++) {
    const d = document.createElement('div');
    d.className = 'step-dot';
    els.steps.appendChild(d);
  }
}

export function setStep(step) {
  [...els.steps.children].forEach((d, i) => {
    d.className = 'step-dot' + (i < step - 1 ? ' done' : i === step - 1 ? ' current' : '');
  });
}

export function setPot(pot, next) {
  els.pot.textContent = fmtMoney(pot);
  els.next.textContent = fmtMoney(next);
}

export function setKills(k) { els.kills.textContent = k; }

export function setAmmo(a, reloading) {
  els.ammo.textContent = reloading ? '···' : a;
}

export function setHealth(h) {
  els.damage.style.opacity = h >= 99 ? 0 : Math.min(1, (100 - h) / 90);
}

let msgTimer = null;
export function flashMsg(text, ms = 2200) {
  els.msg.textContent = text;
  els.msg.classList.add('show');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => els.msg.classList.remove('show'), ms);
}

export function setScoped(v) {
  els.scope.classList.toggle('hidden', !v);
  els.crosshair.style.opacity = v ? 0 : 1;
}

export function showHud(v) {
  els.hud.classList.toggle('hidden', !v);
  document.body.classList.toggle('playing', v);
}

export function fade(on) {
  els.fade.classList.toggle('on', on);
}

// ------------------------------------------------------- typewriter title

export function typewriterTitle(text, done) {
  const el = els.title;
  const target = els.titleText;
  el.classList.remove('hidden');
  target.textContent = '';
  let i = 0;
  const typeIn = () => {
    if (i < text.length) {
      target.textContent = text.slice(0, ++i);
      setTimeout(typeIn, 34);
    } else {
      setTimeout(typeOut, 1700);
    }
  };
  const typeOut = () => {
    if (i > 0) {
      target.textContent = text.slice(0, --i);
      setTimeout(typeOut, 16);
    } else {
      el.classList.add('hidden');
      done?.();
    }
  };
  typeIn();
}

// ---------------------------------------------------------- decision UI

export function showDecision({ step, maxSteps, pot, nextMult, optionA, optionB, cashAmount }, handlers) {
  els.decisionKicker.textContent = `DECISION POINT ${step} / ${maxSteps}`;
  els.decisionPot.textContent = fmtMoney(pot);
  els.decisionNext.textContent = fmtMult(nextMult);
  els.decisionA.textContent = `▸ ${optionA}`;
  els.decisionB.textContent = `▸ ${optionB}`;
  els.decisionCashAmt.textContent = fmtMoney(cashAmount);
  els.decisionA.onclick = () => { hideDecision(); handlers.onContinue('a'); };
  els.decisionB.onclick = () => { hideDecision(); handlers.onContinue('b'); };
  els.decisionCash.onclick = () => { hideDecision(); handlers.onCashOut(); };
  els.decision.classList.remove('hidden');
}

export function hideDecision() {
  els.decision.classList.add('hidden');
}

// ------------------------------------------------------------ result UI

export function showResult({ result, payout, step, kills, bet }, onContinue) {
  const kia = result === 'kia';
  els.resultHeadline.textContent = kia ? 'K.I.A.' : result === 'cashout' ? 'CASHED OUT' : 'EXTRACTED';
  els.resultHeadline.classList.toggle('kia', kia);
  els.resultSub.textContent = kia
    ? `Squad overrun at checkpoint ${step}. Bet lost.`
    : result === 'cashout'
      ? `Exfil confirmed at checkpoint ${step}.`
      : 'Full mission complete. Maximum payout.';
  els.resultPayout.textContent = kia ? `-${fmtMoney(bet)}` : `+${fmtMoney(payout)}`;
  els.resultPayout.style.color = kia ? 'var(--danger)' : 'var(--gold)';
  els.resultStats.innerHTML =
    `<span>CHECKPOINTS <b>${kia ? step - 1 : step}/${GAME.maxSteps}</b></span>` +
    `<span>KILLS <b>${kills}</b></span>` +
    `<span>BET <b>${fmtMoney(bet)}</b></span>`;
  els.resultContinue.onclick = () => {
    els.result.classList.add('hidden');
    onContinue();
  };
  els.result.classList.remove('hidden');
}

// ------------------------------------------------------------- lobby UI

export function renderLobbyMission(m) {
  els.lobbyId.textContent = `${m.lobbyId} · LIVE LOBBY`;
  els.lobbyOp.textContent = m.opName;
  els.lobbyMission.textContent = m.title;
  els.lobbyBlurb.textContent = `${m.location.blurb} ${m.brief}`;
  els.lobbyEmblem.textContent = m.team.emblem;
  els.lobbyTeam.textContent = m.team.name;
  els.lobbyBranch.textContent = m.team.branch.toUpperCase();
}

export function renderRoster(m, joinedCount, playerJoined) {
  const ul = els.lobbyRoster;
  ul.innerHTML = '';
  const li = document.createElement('li');
  li.innerHTML = playerJoined
    ? `<span class="seat-dot"></span><span>YOU</span><span class="r-rank">CDR</span><span class="r-you">SQUAD LEAD</span>`
    : `<span class="seat-dot empty"></span><span style="color:var(--dim)">Awaiting commander…</span>`;
  ul.appendChild(li);
  m.roster.forEach((b, i) => {
    const row = document.createElement('li');
    if (i < joinedCount) {
      row.innerHTML = `<span class="seat-dot"></span><span>${b.callsign}</span><span class="r-rank">${b.rank}</span><span class="r-status">READY</span>`;
    } else {
      row.innerHTML = `<span class="seat-dot empty"></span><span style="color:var(--dim)">Connecting…</span>`;
    }
    ul.appendChild(row);
  });
}

export function setLobbyCountdown(msLeft, totalMs) {
  const frac = Math.max(0, msLeft / totalMs);
  els.lobbyRing.style.strokeDashoffset = 100.5 * (1 - frac);
  els.lobbyRotationS.textContent = Math.ceil(msLeft / 1000);
}

export function setBalance(v) {
  els.lobbyBalance.textContent = fmtMoney(v);
}

export function showLobby(v) {
  els.lobby.classList.toggle('hidden', !v);
}
