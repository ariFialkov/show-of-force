import { GAME } from './config.js';

const KEY = 'sof_wallet_v1';

export const wallet = {
  get balance() {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return GAME.startBalance;
    const v = parseFloat(raw);
    return Number.isFinite(v) ? v : GAME.startBalance;
  },
  set balance(v) {
    localStorage.setItem(KEY, String(Math.max(0, Math.round(v * 100) / 100)));
  },
  debit(v) { this.balance = this.balance - v; },
  credit(v) { this.balance = this.balance + v; },
  reset() { this.balance = GAME.startBalance; }
};
