// Source fingerprints and material slots only. No game or Workshop texture bytes are distributed.
export const version = 1;
const recipe = (file, side, scale, role, source, output) => Object.freeze({ file: file + '.DDS', side, scale, role, source, output });
export async function digest(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
export const refitID = '1976399102-refit';
export const endorID = 'stock-endor';
export const recipes = Object.freeze({
  [endorID]: [
    // The evergreens share a small bark island and branching cutouts in each atlas.
    recipe('W_TREE_EVER_00', 256, 8, 'endorAtlas', '0673afbfffb8598eed00ccf7feed7376f3efa7c3f7e7e4cb22876d5f4dd19d94', 'a259020ddd3a1963aeeb8e09a94f6981d2200d6d454348e2a26ef9f7fbf87012'),
    recipe('W_TREE_EVER_01', 256, 8, 'endorAtlas', '65d7ab8c8d575d344bfe7cad9f0130f63b26fa0998d906d311d2df58a0404ae9', 'dd449d2a9ff5fdcf2429df5ea47b9b32a3155acac8dea9a8182a73f97035ebd4'),
    recipe('W_GRNDMOSS00', 512, 1, 'endorSoil', 'ab5379d7eda66601eb59bdf32491f7eea5ed8d3182cc3fbeb6fb7e0302d788e1', '23f3a4aa7b83d27854abe224457785e472091018528ba1b34ebbcb74fb2094a0'),
    recipe('W_TEMPGRND08', 512, 1, 'endorSoil', 'bb8266300fe647841416d8a018fe836c27eae2f3eb4e73eaf565aac44900f882', '44f1e5aa7ded57074d67a656bc5d12f8e19fa1f2ea9f188f5c860df63cda0852'),
    recipe('W_GRNDMOSS02', 512, 1, 'endorSoil', 'd88c50383653d0576380a50c4f7be15fb938587bf54eea78ff6ad011c9ff4fbe', '09615c154f918e785b5b71887ca6f53d2586f1f2e76e83a44f2ae632cf5774ca'),
    recipe('W_FOREST_GRASS00', 512, 1, 'endorSoil', '530da2edeb39a4c30964f759e267c3041ed6907ceb3dac219a036733dc4d2171', '7283838a1e7434d4cda7e2d7d6bfce4c0d43be6c1e89b047fa11c6930c5d5e30')
  ],
  [refitID]: [
    recipe(
      'VENATOR-CLASS_CM',
      2048,
      1,
      'refitPaint',
      '718961131157e4560fc11f25320d20156f9afbb4b7338eb0cfe2bf658df1888e',
      'a1802604bed675555cb035a06ee53783fe48119bd536d93464af11e908ef9dab'
    ),
    recipe(
      'VENATOR-CLASS_NM',
      2048,
      1,
      'refitNormal',
      'dfe7b421eb593355328a2e85f47fe84f3d4f5f7ff82d0f82f46baee223d477d6',
      '5ea29344369c69f5c0dc7400858ca206602be5791c37c0f773b64d4a52adeb6f'
    ),
    recipe(
      'VENATOR_TURRET_CM',
      256,
      2,
      'refitPaint',
      '13693d9cd6bf34007ec40fe14347d7ec74c80a226c68d03f93fb01258f5986e0',
      '1a9559ab58b903ee1987d591433d42ff97101ae1a9c49c8e97d1d78d196bf733'
    ),
    recipe(
      'VENATOR_TURRET_NM',
      256,
      2,
      'refitNormal',
      'a7d017d0499562907d05b2f5cd1faffa929765d7d10c2d6814ff08b1e73a7163',
      '3375e9602b9ae015f73526a54566d05bc15240143d63b89e22f0b6e1e23d0b6a'
    )
  ],
  stock: [
    recipe(
      'EV_STARDESTROYER',
      512,
      2,
      'imperialHull',
      '878c4420e66addbe6b5cb16f8919397d9d62f1e148114731366aedc0376d33df',
      'f8f813007c93f210b0a9f8cf91927f2e9c44d809c94baf07e911965665c0655d'
    ),
    // The Naboo ALOs actually bind the Alderaan surface. Other models sharing it benefit too.
    recipe(
      'W_PLANET_ALDERAAN',
      1024,
      2,
      'planet',
      '77f82c85c519dc3a9d630d3dc22fc68d2e8e6d182f28866f8bd4f7c9580ca435',
      '6b3f5d02afcf8651a890190217fd8a6efc109798376ff855443775197dfc992f'
    ),
    recipe(
      'W_PLANET_ALDERAAN_LOW',
      256,
      2,
      'planet',
      'e549f195b2ae6736f9e3f5535fd64fc1dfe02e3e87159f3136adb5922f4f80f9',
      '629eed5db68addff35970f5d1eee595ccd09d5faccfaea1afca8542f88499e6f'
    ),
    // Three most frequently painted terrain layers on _Land_Planet_Kuat_02. The terrain atlas is 512 per slice.
    recipe(
      'W_TEMPERATE_GRASSROCK00',
      512,
      1,
      'grassRock',
      'ac7004715b330a100703ab5af590b65eb6cd19922fddaa94ba60901bfc88b2a8',
      '4ebcf6d81c3fd6df501654d13b10a3b6b84a11c308f6278d6d96f4d59269febc'
    ),
    recipe(
      'W_TEMPERATE_GRAVELBRWN00',
      512,
      1,
      'gravel',
      '1269abbeecad614fdc861ae407d3beb41b206cdf959c46932431dcf1c198455c',
      '9018d8d5c36296c6acf9dde71757330042c502ed1a20171ef377a873ad767b0d'
    ),
    recipe(
      'W_TEMPERATE_GRASSFLOWR01',
      512,
      1,
      'meadow',
      '9efccefeee3fbe1e54bf4ca48ae5d351b5d78beb0494982a217d0844e58677ad',
      '570deb037063db3c770c1702ee2ce5f801b917e3109e69e7479b8c56a0858eda'
    )
  ],
  1976399102: [
    recipe(
      'VENATOR-CLASS_CM',
      2048,
      2,
      'republicHull',
      '718961131157e4560fc11f25320d20156f9afbb4b7338eb0cfe2bf658df1888e',
      'd0c3bb0a16488542b5725e87b76e109635ece4268b62bc3a38daccb4cc0d98e3'
    ),
    recipe(
      'VENATOR_TURRET_CM',
      256,
      2,
      'republicHull',
      '13693d9cd6bf34007ec40fe14347d7ec74c80a226c68d03f93fb01258f5986e0',
      '2ac321cf524e45ff321bd02d0995a57d6459212977ee442def5613828a00e22d'
    )
  ]
});
export const packKey = profile => 'texture-showcase-v1:' + profile;
export const sizeOfMip = n => Math.ceil(n / 4) ** 2 * 16;
export function outputBytes(r) {
  let bytes = 128;
  for (let n = r.side * r.scale; n >= 1; n >>= 1) bytes += sizeOfMip(n);
  return bytes;
}
export function isOutput(bytes, r) {
  if (bytes.byteLength !== outputBytes(r)) return false;
  const d = new DataView(bytes.buffer, bytes.byteOffset, 128),
    u = i => d.getUint32(i * 4, true),
    n = r.side * r.scale;
  return (
    u(0) === 0x20534444 &&
    u(1) === 124 &&
    u(3) === n &&
    u(4) === n &&
    u(7) === 1 + Math.log2(n) &&
    u(19) === 32 &&
    u(20) === 4 &&
    u(21) === 0x35545844 &&
    u(28) === 0
  );
}
