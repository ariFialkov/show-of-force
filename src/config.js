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
    id: 'raid', name: 'Raid',
    subtypes: ['Compound Raid', 'Armory Raid', 'Comms Blackout Raid', 'Night Raid'],
    brief: 'Hit the objective hard, clear every strongpoint, exfil before reinforcements arrive.'
  },
  ambush: {
    id: 'ambush', name: 'Ambush',
    subtypes: ['Convoy Ambush', 'Patrol Ambush', 'Kill-Zone Ambush'],
    brief: 'Set the trap, spring it on the hostile column, sweep the survivors.'
  },
  rescue: {
    id: 'rescue', name: 'Rescue',
    subtypes: ['Hostage Rescue', 'Downed Pilot Recovery', 'Asset Extraction'],
    brief: 'Locate the friendly, break the cordon, bring everyone home.'
  },
  elimination: {
    id: 'elimination', name: 'Direct Elimination',
    subtypes: ['HVT Assassination', 'Command Decapitation', 'Bounty Contract'],
    brief: 'One target. Confirm identity, eliminate, disappear.'
  },
  recovery: {
    id: 'recovery', name: 'Site Recovery',
    subtypes: ['Intel Recovery', 'Weapons Cache Recovery', 'Black-Box Recovery'],
    brief: 'Secure the site, recover the package, deny everything else.'
  }
};

// Decision-point flavor: pairs of tactical options per mission type.
export const DECISIONS = {
  raid: [
    ['Breach the main gate', 'Cut through the service alley'],
    ['Smoke and push the courtyard', 'Climb the collapsed wall'],
    ['Clear the guard post first', 'Slip past under the walkway'],
    ['Blow the barricade', 'Take the drainage tunnel'],
    ['Assault the barracks head-on', 'Flank along the rooftops']
  ],
  ambush: [
    ['Take the high overlook', 'Set charges on the road'],
    ['Hit the lead vehicle', 'Wait for the full column'],
    ['Push through the kill zone', 'Circle behind the wreckage'],
    ['Chase the runners', 'Hold and re-set the trap'],
    ['Sweep the ditch line', 'Advance up the median']
  ],
  rescue: [
    ['Follow the drag marks', 'Interrogate route through the market'],
    ['Breach the holding cell block', 'Draw guards to the depot'],
    ['Carry the friendly through the yards', 'Secure a vehicle first'],
    ['Run the searchlight gap', 'Cut power at the substation'],
    ['Break for the extraction lane', 'Hole up and thin the pursuit']
  ],
  elimination: [
    ['Stalk through the compound edge', 'Move under the vantage line'],
    ['Take the long-angle shot', 'Close in for confirmation'],
    ['Silence the bodyguard detail', 'Bypass and isolate the target'],
    ['Exfil through the crowd', 'Vanish over the back wall'],
    ['Push the panic route', 'Ambush the escape car']
  ],
  recovery: [
    ['Sweep the crash perimeter', 'Go straight for the debris field'],
    ['Crack the site vault', 'Strip the comms mast first'],
    ['Carry the package low route', 'Ridge route with overwatch'],
    ['Burn the leftover intel', 'Rig the site and move'],
    ['Sprint the open ground', 'Leapfrog cover by pairs']
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
  maxSteps: 10,
  rtp: 1.0,
  lobbyRotateMs: 15000,
  squadSize: 4, // player + 3 comrades
  startBalance: 1000,
  minBet: 1,
  maxBet: 500,
  betChips: [1, 5, 10, 25, 50, 100]
};
