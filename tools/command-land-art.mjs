// Decorative ground environments for the command ring only. These identifiers
// never resolve a launch map or relax the digest match on tactical battle photos.
import fs from 'node:fs/promises';
import { artRoot, digest } from './workshop-battle-art.mjs';
import { mediaFile } from './workshop-media.mjs';
export const landViews = {
  coruscant: '453546f255b5d695c3a51bacbde2ee503ee96f2d9e26613f1abf6b8ed0096fa9',
  geonosis: '8a0579b8542460e968617721c57dfb1e5544a05dfd669e2f38eced3136c8aba3',
  yavin: '6d328243106df34a38116b8f7a2c29df750f62d78b2c93434d8422abdba07f51',
  korriban: '2acdce8dc4df8411503533f06d59b31f5bfe01d53922f5e9308ddae77ab4ac18',
  tatooine: 'b59031d96331433e8432693ac29d7606eeb8bb7647bb00aec38105c7e6fe8fa0',
  mandalore: 'dc37fda9ab579417047b4d694f452af0bf4769cf31e5e4a5ef87ef9f8d7d29f7',
  bastion: '80198e3df23eafc2da6bc3b12cf4212e25c18d058425da6be1de822520a6aa8b',
  corellia: 'ae5464b39277484903a420c6f5a1ac5aadeb493337bfb5bedfce9d525758c44e',
  hapes: '6022f3a0b3723150409ece2dd703b1af6a4cc11cddb69d01fa4c2f0110b5d89b',
  csilla: '2dc2b034a26cf2576cffeb3e14b3c04ec00aa730938ef453616dca378d51e41e',
  ryloth: '0e465f6923b23f4c552accedb08e2b02648d583c4640dc46f81da7597cf63ca2',
  felucia: '5e8795339aa22b67082169b6af66edbf726f95ed5d4c445407dcd48818958eff',
  mustafar: 'eee304d0b56d24d85e9186d8adbea74cf46a2dcb31056ff0ca06f3d263d998a6',
  naboo: '435ef9ae0987069e159325c2e5c66b15bec08c93034d0055a51a2143e4b14f1d',
  florrum: 'b57dce137d3d254b278e01204a2f42ae4ef8b55f425bf97ee11ea69fe5e6ab35',
  narshaddaa: '4d92903f15e703c21d382cc8fa8a0280fff6de9fb9d933027fc81f6b5f829784',
  bonadan: '8dce0ae61bef65be2c2c0e355426c967df165159a83d0e0cd03d6213f9fde02f',
  anaxes: '86fb0c541c786100f4f1d733e8cc93afda0795e216a86032b3c17f7716ed5e92',
  ordmantell: 'b943f0d2cde865309e7ad9b728773951aa8651c689bd445fda0f6317dc2be324',
  lwhekk: '373c4effec5431d7e21111cc0edca350a24c0a51cb0b4eae918211a6b7defa53',
  serenno: '62345ef0433732f4eb1e93c03e2e1ed9f38fc37b0a81b9b4cfce3c70fffe40ba',
  helska: 'f8d5d0af70583593705f96f0fb34131c9905e63305958cfe109276f5c73714f9',
  nirauan: 'dae8f692d67e05df9563cc42d957e849b66b5f368bab231b3948a6e52a8d9307',
  lehon: '413871ca2e1a4770f329146d41e395ec8af00229d888253d929ce97d55e270db',
  muunilinst: '84dd362bfdcac37ae58deda9d0b9447080182b6655c71a579ae13bd9b12f6b00',
  dathomir: '9acb051f14b859e5087d23a08e0f7aaf83d52879ad3557705477393730956c8e',
  nalhutta: '4411155a6e13cf0bbfdbcf2339a7b532d9140981fea1e03967911f0f59265784',
  eriadu: 'a41b46546f20768ba9f8d366a0af0a48de186f13465882b7335aa9d742d13ae5',
  dantooine: 'd9df7bc56e5cbafc29031edfdd68ffcb59ac5b3a364bba68dbad01b43a3a3fd4'
};
export async function commandLandArt(id) {
  try {
    const root = artRoot(),
      sha = Object.hasOwn(landViews, id) && landViews[id];
    const file = sha && root && mediaFile(root, sha + '.jpg', 12 * 1024 * 1024);
    if (file) {
      const b = await fs.readFile(file.file);
      if (digest(b) === sha) return b;
    }
  } catch {}
  return null;
}
