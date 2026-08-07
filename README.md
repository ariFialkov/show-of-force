# Show of Force

A first-person 3D **stepper betting game** playable on desktop and mobile as an
installable PWA. You play a special-forces commander leading a small squad
through a procedurally generated mission. Every checkpoint you clear raises the
pot along a multiplier ladder — at each decision point you pick a tactical route
(or **cash out**) until you either extract with the max multiplier or the round
busts.

Built with [Three.js](https://threejs.org/) + Vite. No art assets — every model,
map, icon, and sound is generated procedurally at runtime.

## How the betting works

- The game is a **stepper / crash hybrid**: max 10 checkpoints on an
  escalating multiplier ladder (at RTP 1.0: ≈×0.42 → ×4.30). The first three
  rungs pay **below stake** (cash-out locked), break-even lands at
  checkpoint 4, and the bust hazard peaks around checkpoints 4-5 — early
  steps are nearly safe, the mid-game is where rounds die.
- The entire round outcome (which step busts, if any) is drawn **up-front** in
  `src/rtp.js` from fresh entropy — the only inputs that affect payout are the
  bet amount and the configured RTP (`GAME.rtp` in `src/config.js`, default 1.0).
- Everything in the 3D world is presentation on top of that draw:
  - Enemy bots always *miss* unless the round is scripted to bust at the
    current step, and your comrade bots finish off anything you don't kill.
  - Your kills visually accelerate the pot toward the next rung, but the rung
    value itself is fixed by the ladder.
  - If the current step is the bust step, the squad is overrun and the round
    ends regardless of player skill.
- At every decision point you get two tactical options (both continue the
  mission) plus **Cash Out** at the current secured amount.
- The option you pick becomes the next fight: choices are tagged with
  set-pieces — a destructible getaway car with its crew, a manned crate
  barricade, or a watchtower sniper — spawned into the upcoming segment.
- Combat is line-of-sight honest: nobody (including your own squad and your
  bullets) shoots through walls; tracers clip at the first solid surface,
  and unseen enemies hunt toward you instead of blind-firing.

## Themes

Five squads, each tied to a mission domain and two locations:

| Team | Domain | Locations |
|---|---|---|
| Delta Force | Land | Al-Qasra, Wadi Ramal |
| Navy SEALs | Sea | Mbandazi, Mys Morozov |
| Green Berets | Jungle | Suối Mù, Kambi ya Simba |
| Army Rangers | Paratroop | Felsengrad, Sakhra Deh |
| Sicarios SWAT | Anti-Cartel | San Carlos de la Frontera, La Rinconada Oculta |

Mission types: Raid, Ambush, Rescue, Direct Elimination, Site Recovery — each
with randomized subtypes and operation names. The lobby rotates to a fresh
mission every 15 seconds, with simulated players joining as your squadmates.

## Controls

**Desktop** — WASD move · mouse-look (click to lock pointer) · left-click fire ·
right-click scope/unscope · Space frag.

**Mobile** — LEFT dynamic joystick: aim (double-tap left side to scope/unscope) ·
RIGHT dynamic joystick: move · FIRE and FRAG buttons.

## Development

```bash
npm install
npm run dev        # dev server (LAN-exposed for phone testing)
npm run build      # production build in dist/
npm run preview    # serve the production build
npm run icons      # regenerate PWA PNG icons (committed in public/icons)
```

The service worker (`public/sw.js`) is registered only in production builds, so
`npm run build && npm run preview` (or any static host over HTTPS) is what you
want for testing installability/offline. Serve `dist/` from any static host.

## Project layout

```
src/
  config.js       teams, locations, mission types, tunables (RTP, steps, bets)
  rtp.js          multiplier ladder + round outcome draw (the real game)
  missions.js     lobby/mission generation, bot rosters
  ui.js           lobby, HUD, decision & result overlays, typewriter title
  main.js         app state machine wiring lobby <-> rounds
  game/
    mapgen.js     maze-like corridor/decision-room map generation
    world.js      themed environment building (walls, buildings, props)
    models.js     procedural low-poly soldiers + insertion vehicles
    bots.js       enemy theater AI + comrade escort AI
    controls.js   desktop + dual dynamic joystick touch input
    effects.js    tracers/explosions + synthesized WebAudio SFX
    game.js       engine: modes, prelude, combat, scripted outcomes
```

Player funds are simulated (localStorage wallet starting at $1,000) — there is
no real-money integration.
