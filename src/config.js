// Static game configuration: teams, locations, mission types, flavor text.

export const TEAMS = {
  delta: {
    id: 'delta',
    name: 'Delta Force',
    branch: 'Infantry',
    tag: 'DELTA',
    emblem: '⚔',
    domain: 'land',
    vehicle: 'humvee',
    vehicleName: 'M1245 Assault Humvee',
    backup: 'flashgl',
    gear: 'helmet-delta',
    camo: { cloth: 0x5b5843, vest: 0x3d3a2c, helmet: 0x4a4636, skin: 0xc9a06c }
  },
  seals: {
    id: 'seals',
    name: 'Navy SEALs',
    branch: 'Navy',
    tag: 'SEAL',
    emblem: '⚓',
    domain: 'sea',
    vehicle: 'boat',
    vehicleName: 'Stealth CRRC Dinghy',
    backup: 'harpoon',
    gear: 'helmet-seal',
    camo: { cloth: 0x3a4148, vest: 0x272c31, helmet: 0x30363c, skin: 0xb98d5e }
  },
  berets: {
    id: 'berets',
    name: 'Green Berets',
    branch: 'Infantry',
    tag: 'ODA',
    emblem: '⚑',
    domain: 'jungle',
    vehicle: 'truck',
    vehicleName: 'GMV Jungle Runner',
    backup: 'knife',
    gear: 'helmet-beret',
    camo: { cloth: 0x3f5233, vest: 0x2c3b24, helmet: 0x36452c, skin: 0xa97b4f }
  },
  rangers: {
    id: 'rangers',
    name: 'Army Rangers',
    branch: 'Airborne',
    tag: 'RGR',
    emblem: '✈',
    domain: 'paratroop',
    vehicle: 'parachute',
    vehicleName: 'MC-6 Static Line Drop',
    backup: 'shotgun',
    gear: 'helmet-delta',
    camo: { cloth: 0x55503f, vest: 0x3c382c, helmet: 0x46422f, skin: 0xd3a878 }
  },
  sicarios: {
    id: 'sicarios',
    name: 'Sicarios SWAT',
    branch: 'Anti-Cartel',
    tag: 'SWAT',
    emblem: '⛨',
    domain: 'cartel',
    vehicle: 'apc',
    vehicleName: 'BearCat G3 APC',
    backup: 'rpg',
    gear: 'helmet-balaclava',
    camo: { cloth: 0x23262b, vest: 0x15171b, helmet: 0x1d2025, skin: 0xb98d5e }
  }
};

export const LOCATIONS = {
  alqasra: {
    id: 'alqasra', domain: 'land', name: 'Al-Qasra',
    blurb: 'Mud-brick desert town wrapped around an old oasis fort.',
    env: {
      sky: 0xd7b98a, fog: 0xcfae7d, fogDensity: 0.016, ground: 0xc2a06a,
      wall: 0xa8834f, wallAlt: 0x8f6d40, building: 0xb08c55, sun: 0xffe0b0,
      sunIntensity: 1.25, hemi: 0xead9b0, hemiGround: 0x8a6f45,
      props: ['palm', 'crate', 'rock', 'awning'], night: false
    }
  },
  wadi: {
    id: 'wadi', domain: 'land', name: 'Wadi Ramal',
    blurb: 'Settlement sunk deep between rolling dunes in the Valley of Sands.',
    env: {
      sky: 0xe8c9a0, fog: 0xdcb98d, fogDensity: 0.02, ground: 0xd4b078,
      wall: 0xbb9257, wallAlt: 0xa07b48, building: 0xc09a60, sun: 0xfff0cc,
      sunIntensity: 1.35, hemi: 0xf2e2bb, hemiGround: 0x9c7c4e,
      props: ['rock', 'palm', 'crate', 'dune'], night: false
    }
  },
  mbandazi: {
    id: 'mbandazi', domain: 'sea', name: 'Mbandazi',
    blurb: 'Dense East African port city, salt air and rusted tin roofs.',
    env: {
      sky: 0x9fb8c4, fog: 0x93aab6, fogDensity: 0.02, ground: 0x8b8271,
      wall: 0x7d8a8a, wallAlt: 0x6a7574, building: 0x94847a, sun: 0xfff4dd,
      sunIntensity: 1.0, hemi: 0xcfdce2, hemiGround: 0x6f6a5a,
      props: ['container', 'barrel', 'crate', 'palm'], water: true, night: false
    }
  },
  morozov: {
    id: 'morozov', domain: 'sea', name: 'Mys Morozov',
    blurb: 'Fog-shrouded oligarch retreat on a private Black Sea cape.',
    env: {
      sky: 0x6d7f8e, fog: 0x64707c, fogDensity: 0.028, ground: 0x5e6a6e,
      wall: 0x707a80, wallAlt: 0x5c666c, building: 0x8a9096, sun: 0xcfe0ee,
      sunIntensity: 0.7, hemi: 0x9fb2c0, hemiGround: 0x46505a,
      props: ['hedge', 'lamp', 'crate', 'statue'], water: true, night: true
    }
  },
  suoimu: {
    id: 'suoimu', domain: 'jungle', name: 'Suối Mù',
    blurb: 'Vietnamese river village lost in the mist of Misty Creek.',
    env: {
      sky: 0x8fa48a, fog: 0x87a087, fogDensity: 0.034, ground: 0x4f6136,
      wall: 0x5d6b3f, wallAlt: 0x4a5733, building: 0x6f6046, sun: 0xe8f0d8,
      sunIntensity: 0.8, hemi: 0xb9c8a8, hemiGround: 0x3a4a28,
      props: ['tree', 'fern', 'hut', 'rock'], night: false
    }
  },
  kambi: {
    id: 'kambi', domain: 'jungle', name: 'Kambi ya Simba',
    blurb: 'Rebel camp carved out of Congo canopy — Camp of the Lion.',
    env: {
      sky: 0x7d9070, fog: 0x6f855f, fogDensity: 0.03, ground: 0x45552e,
      wall: 0x55663a, wallAlt: 0x42522e, building: 0x64553c, sun: 0xf2ecc8,
      sunIntensity: 0.85, hemi: 0xa8bd90, hemiGround: 0x33421f,
      props: ['tree', 'crate', 'barrel', 'tent'], night: false
    }
  },
  felsengrad: {
    id: 'felsengrad', domain: 'paratroop', name: 'Felsengrad',
    blurb: 'Alpine stronghold cut into a Swiss rock ridge.',
    env: {
      sky: 0xb9c9d8, fog: 0xaebfcf, fogDensity: 0.018, ground: 0x8f9aa2,
      wall: 0x7a838c, wallAlt: 0x656e78, building: 0x9aa4ab, sun: 0xffffff,
      sunIntensity: 1.15, hemi: 0xd7e4ef, hemiGround: 0x6b7680,
      props: ['pine', 'rock', 'crate', 'antenna'], snow: true, night: false
    }
  },
  sakhra: {
    id: 'sakhra', domain: 'paratroop', name: 'Sakhra Deh',
    blurb: 'Stone-and-mud terror camp camouflaged in Afghan peaks.',
    env: {
      sky: 0xc4b49a, fog: 0xb3a289, fogDensity: 0.02, ground: 0x99805c,
      wall: 0x86704c, wallAlt: 0x715d3e, building: 0x8d7752, sun: 0xffeecb,
      sunIntensity: 1.1, hemi: 0xd9c9a8, hemiGround: 0x6e5b3e,
      props: ['rock', 'crate', 'antenna', 'tent'], night: false
    }
  },
  sancarlos: {
    id: 'sancarlos', domain: 'cartel', name: 'San Carlos de la Frontera',
    blurb: 'Dusty border town straddling the line — cartel country.',
    env: {
      sky: 0xd9b48a, fog: 0xc9a67e, fogDensity: 0.017, ground: 0xb08c5c,
      wall: 0xa3794a, wallAlt: 0x8c6740, building: 0xb5885a, sun: 0xffd9a8,
      sunIntensity: 1.2, hemi: 0xe8d3ac, hemiGround: 0x82633c,
      props: ['cactus', 'barrel', 'crate', 'awning'], night: false
    }
  },
  rinconada: {
    id: 'rinconada', domain: 'cartel', name: 'La Rinconada Oculta',
    blurb: 'Hidden cocaine estate folded into Colombian hills.',
    env: {
      sky: 0x93a87e, fog: 0x869c72, fogDensity: 0.026, ground: 0x59683a,
      wall: 0x6a7a44, wallAlt: 0x556338, building: 0x7d6b4a, sun: 0xf5eecd,
      sunIntensity: 0.9, hemi: 0xbccaa0, hemiGround: 0x42502a,
      props: ['tree', 'fern', 'crate', 'hut'], night: false
    }
  }
};

export const DOMAIN_TEAM = {
  land: 'delta', sea: 'seals', jungle: 'berets', paratroop: 'rangers', cartel: 'sicarios'
};

export const MISSION_TYPES = {
  raid: {
    id: 'raid', name: 'Raid', steps: [6, 8],
    subtypes: ['Compound Raid', 'Armory Raid', 'Comms Blackout Raid', 'Night Raid'],
    brief: 'Hit the objective hard, clear every strongpoint, exfil before reinforcements arrive.'
  },
  ambush: {
    id: 'ambush', name: 'Ambush', steps: [5, 7],
    subtypes: ['Convoy Ambush', 'Patrol Ambush', 'Kill-Zone Ambush'],
    brief: 'Set the trap, spring it on the hostile column, sweep the survivors.'
  },
  rescue: {
    id: 'rescue', name: 'Rescue', steps: [7, 10],
    subtypes: ['Hostage Rescue', 'Downed Pilot Recovery', 'Asset Extraction'],
    brief: 'Locate the friendly, break the cordon, bring everyone home.'
  },
  elimination: {
    id: 'elimination', name: 'Direct Elimination', steps: [3, 5],
    subtypes: ['HVT Assassination', 'Command Decapitation', 'Bounty Contract'],
    brief: 'One target. Confirm identity, eliminate, disappear.'
  },
  recovery: {
    id: 'recovery', name: 'Site Recovery', steps: [5, 8],
    subtypes: ['Intel Recovery', 'Weapons Cache Recovery', 'Black-Box Recovery'],
    brief: 'Secure the site, recover the package, deny everything else.'
  }
};

// ------------------------------------------------------------- objectives
//
// Every checkpoint segment runs one OBJECTIVE, built from 8 mechanical
// archetypes the engine knows how to stage:
//   sweep    kill every hostile in the segment to open the checkpoint
//   destroy  a destructible target (prop kinds below) must be destroyed
//   hvt      a marked target the COMMANDER must personally drop
//   stealth  patrols + detection meter; stay unseen or it goes loud
//   interact hold position at a device to plant/download/disable
//   hold     defend the checkpoint zone against attack waves
//   timed    beat the clock to the checkpoint
//   escort   pick up an asset who follows the column
//
// prop kinds for `destroy`: car, cache, comms, generator, aa, mortar
// site kinds for `interact`: console, charge

const O = (mech, title, prop = null) => ({ mech, title, prop });

// Mission arcs: opening step, middle pool, late pool (last third), finale.
export const OBJECTIVE_ARCS = {
  raid: {
    open: [
      O('sweep', 'Breach and clear the outer compound'),
      O('stealth', 'Infiltrate the perimeter undetected')
    ],
    mid: [
      O('sweep', 'Clear the barracks'),
      O('sweep', 'Eliminate all hostiles in the motor pool'),
      O('destroy', 'Destroy the weapons cache', 'cache'),
      O('destroy', 'Destroy the comms array', 'comms'),
      O('interact', 'Plant C4 on the armory', 'charge'),
      O('hold', 'Break the enemy counterattack'),
      O('hvt', 'Capture the enemy commander')
    ],
    late: [
      O('destroy', 'Destroy the AA emplacement', 'aa'),
      O('hold', 'Hold the strongpoint'),
      O('sweep', 'Retake the checkpoint')
    ],
    final: [
      O('timed', 'Escape before reinforcements arrive'),
      O('sweep', 'Push to extraction')
    ]
  },
  ambush: {
    open: [
      O('stealth', 'Set the kill zone quietly'),
      O('stealth', 'Mark the convoy route undetected')
    ],
    mid: [
      O('destroy', 'Destroy the lead vehicle', 'car'),
      O('destroy', 'Destroy the getaway vehicle', 'car'),
      O('sweep', 'Eliminate the convoy escort'),
      O('hold', 'Hold the ambush line'),
      O('hvt', 'Eliminate the escort leader')
    ],
    late: [
      O('destroy', 'Silence the mortar position', 'mortar'),
      O('timed', 'Catch the fleeing trucks'),
      O('sweep', 'Sweep the survivors')
    ],
    final: [
      O('timed', 'Reach extraction before the airstrike'),
      O('sweep', 'Push to extraction')
    ]
  },
  rescue: {
    open: [
      O('stealth', 'Infiltrate the holding area'),
      O('interact', 'Cut the external power', 'console')
    ],
    mid: [
      O('sweep', 'Clear the cell block'),
      O('escort', 'Escort the hostage'),
      O('escort', 'Carry the wounded VIP'),
      O('interact', 'Hack the security doors', 'console'),
      O('sweep', 'Secure the evacuation corridor'),
      O('hold', 'Defend the medevac')
    ],
    late: [
      O('escort', 'Move the asset toward the LZ'),
      O('hold', 'Defend the extraction point'),
      O('sweep', 'Clear the landing zone')
    ],
    final: [
      O('timed', 'Reach extraction with the asset'),
      O('escort', 'Exfiltrate with the hostage')
    ]
  },
  elimination: {
    open: [
      O('stealth', 'Track the HVT undetected'),
      O('stealth', 'Slip the compound edge unseen')
    ],
    mid: [
      O('interact', 'Photograph the meeting', 'console'),
      O('stealth', 'Shadow the bodyguard detail'),
      O('sweep', 'Silence the bodyguards')
    ],
    late: [
      O('hvt', 'Neutralize the HVT')
    ],
    final: [
      O('timed', 'Vanish before the lockdown'),
      O('stealth', 'Exfil without a trace')
    ]
  },
  recovery: {
    open: [
      O('sweep', 'Sweep the crash perimeter'),
      O('stealth', 'Locate the site quietly')
    ],
    mid: [
      O('interact', 'Recover the encrypted laptop', 'console'),
      O('interact', 'Recover the black box', 'console'),
      O('destroy', 'Destroy the explosives cache', 'cache'),
      O('destroy', 'Kill the power generator', 'generator'),
      O('destroy', 'Destroy the satellite uplink', 'comms'),
      O('sweep', 'Search the cargo yard')
    ],
    late: [
      O('interact', 'Secure the intel before deletion', 'console'),
      O('destroy', 'Burn the leftover stockpile', 'cache')
    ],
    final: [
      O('timed', 'Carry the package to extraction'),
      O('sweep', 'Push to extraction')
    ]
  }
};

// Decision options describe HOW to take on the next objective, and each
// carries a RISK class. Risk scales that step's true survival odds by the
// factor below, with the step's payout gain scaled inversely — so every
// option has identical EV and the RTP is untouched by the choice.
export const RISK_FACTORS = { safe: 1.08, std: 1.0, risky: 0.78 };

export const APPROACH = {
  sweep: [
    { t: 'Sweep in from the flank', risk: 'safe' },
    { t: 'Clear it room by room', risk: 'safe' },
    { t: 'Stack up and breach', risk: 'std' },
    { t: 'Split and pincer them', risk: 'std' },
    { t: 'Go in loud', risk: 'risky' },
    { t: 'Push straight up the middle', risk: 'risky' }
  ],
  destroy: [
    { t: 'Pick off the guards first', risk: 'safe' },
    { t: 'Frag it from cover', risk: 'safe' },
    { t: 'Overwatch and volley fire', risk: 'std' },
    { t: 'Hit it from the alley', risk: 'std' },
    { t: 'Charge and hose it down', risk: 'risky' }
  ],
  hvt: [
    { t: 'Drop him from range', risk: 'safe' },
    { t: 'Cut off his escape first', risk: 'std' },
    { t: 'Close for the confirmed kill', risk: 'risky' }
  ],
  stealth: [
    { t: 'Time the patrol gaps', risk: 'safe' },
    { t: 'Hug the shadow line', risk: 'std' },
    { t: 'Crawl the drainage line', risk: 'std' },
    { t: 'Ghost straight through', risk: 'risky' }
  ],
  interact: [
    { t: 'Secure the area first', risk: 'safe' },
    { t: 'Cover me while I work', risk: 'std' },
    { t: 'Fast hands, no cover', risk: 'risky' }
  ],
  hold: [
    { t: 'Dig in behind cover', risk: 'safe' },
    { t: 'Anchor the corners', risk: 'std' },
    { t: 'Meet them at the mouth', risk: 'risky' }
  ],
  timed: [
    { t: 'Bounds by pairs, steady', risk: 'safe' },
    { t: 'Cut through the side lanes', risk: 'std' },
    { t: 'Dead sprint, no stops', risk: 'risky' }
  ],
  escort: [
    { t: 'Shield the package', risk: 'safe' },
    { t: 'Keep the asset close', risk: 'std' },
    { t: 'Speed over caution', risk: 'risky' }
  ]
};

export const CALLSIGNS = [
  'Viper', 'Ghost', 'Tex', 'Havoc', 'Sable', 'Rook', 'Duke', 'Frost',
  'Mongoose', 'Saint', 'Bricks', 'Nomad', 'Ratchet', 'Coyote', 'Judge',
  'Pyro', 'Slate', 'Wraith', 'Bishop', 'Tango', 'Halo', 'Chief', 'Dozer',
  'Reaper', 'Static', 'Maverick', 'Ox', 'Sandman', 'Vandal', 'Kilo'
];

export const RANKS = ['SGT', 'SSG', 'SFC', 'CPL', 'SPC', 'WO1', 'MSG'];

export const OP_ADJ = ['Silent', 'Iron', 'Broken', 'Crimson', 'Hollow', 'Burning', 'Black', 'Savage', 'Frozen', 'Phantom'];
export const OP_NOUN = ['Talon', 'Anvil', 'Serpent', 'Lantern', 'Spear', 'Harvest', 'Vigil', 'Cobra', 'Rampart', 'Ember'];

export const GAME = {
  rtp: 1.0,
  lobbyRotateMs: 15000,
  squadSize: 4, // player + 3 comrades
  startBalance: 1000,
  minBet: 1,
  maxBet: 500,
  betChips: [1, 5, 10, 25, 50, 100]
};
