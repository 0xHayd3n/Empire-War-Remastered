import { createHash } from 'node:crypto';

// FOTR's Factions.xml explicitly marks Underworld unused. Universal can give
// that sandbox seat a named expeditionary complement, NOT an official FOTR
// fleet. These are actual starting wings of the pack's Pirate_Base. Pin the
// reviewed declaration; do not execute Lua, infer ownership from asset names,
// look for similar ships in stock, or guess after a Workshop update.
const file = 'Data/Scripts/Library/eawx-mod-fotr/gameobjects/PIRATE_BASE.lua';
const digest = '5b41aa5dea01ca6699384a2d8d5163beae96e99447e7c4dea46e66b978554e91';
export function tacticalAuxiliaries(id, v) {
  if (id !== '1976399102') return [];
  const path = v.resolve(file),
    bytes = path && v.read(path);
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== digest) return [];
  return [
    {
      owner: 'Underworld',
      domain: 'space',
      label: 'Universal pirate-base auxiliaries',
      source: file,
      units: [
        'Morningstar_A_Squadron_Double',
        'Gozanti_Cruiser_Raider_Squadron',
        'Skirmish_IPV1_Gunboat',
        'Skirmish_Consular_Refit',
        'Skirmish_DHC_Gunboat'
      ]
    }
  ];
}
