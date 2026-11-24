import { createHash } from 'node:crypto';
import { parseXML } from '../public/js/xml.js';
import { rescueCampaign } from '../public/js/game/universalrules.js';
// These winning stock files define the campaign and its three faction plots. No
// GC scripts are borrowed. A modified plot, including an AI plot, fails closed.
const reviewed = {
  'CampaignFiles.xml': '84037a8345a96742c42846e068413055b61c3684211e6722ca37f75bf1a35d39',
  'Campaigns_Underworld_GC.xml': '5d9c49c968061ac8672c13d7cbed10ac24d039a66cd659805bfb72b0039b81ee',
  'HeroCompanies.xml': 'a69629539a6782f43bb79e40e8d20806bed94736667718b6c2bd71ab97c94830',
  'Story_Plots_Sandbox_56_Rebel.xml': '8ac5be6873288b6ba1ef2b63cf40982e044811467fa2be150f7b0faa6e9499c9',
  'Story_Sandbox_56_Rebel.xml': '39d7afe49e69d1cef6f89c057f2d1565bbfede17506003c49706da49fd244e30',
  'Story_Plots_Empire_AI_Heroes_EXP.xml': '453dd210c0b04a563521cf035be7c9a4db1123eda6b5e02bba3d00e01dac163f',
  'Story_Empire_AI_Heroes_EXP.xml': '74cba9dddd1e26fd4f14c99ccbfeecd510612ed3574be5fd08c5d6a655fdaec6',
  'Story_Plots_Underworld_AI_Heroes.xml': '8b8bb3963121e3ac3a87a341c2c5a53ad7b15fbdc2de35b7df2e8d091fd93136',
  'Story_Underworld_AI_Heroes.xml': 'd98086644ab646fca4788e4f9bc03b3657e511a6fa101e0e14bb3ab9b9560038'
};
export function combatCatalog(archive, pack, campaigns) {
  const read = name => archive.read(archive.resolve('Data/XML/' + name)),
    k = archive.resolve('Data/XML/GameConstants.xml'),
    bytes = k && archive.read(k),
    constants = bytes && parseXML(bytes.toString('latin1')).children[0],
    raw = constants?.all('AutoResolveTransportLosses').at(-1)?.text.trim(),
    native = raw === undefined ? 0.333333 : Number(raw);
  const allowed = [...campaigns.values()]
    .filter(c => !c.bool('Is_Multiplayer') && !c.bool('Tutorial') && c.bool('Is_Autoresolve_Allowed', true))
    .map(c => c.name);
  const c = campaigns.get(rescueCampaign.toUpperCase());
  return {
    transport:
      constants && Number.isFinite(native) && native >= 0 && native <= 1 && raw !== ''
        ? { native, declared: !!raw && (!pack || !!pack.entries.get(k)), allowed }
        : null,
    rescue:
      !pack &&
      c?.name === rescueCampaign &&
      c.str('Starting_Active_Player') === 'Rebel' &&
      !c.bool('Is_Story_Campaign') &&
      c.str('Rebel_Story_Name') === 'Story_Plots_Sandbox_56_Rebel.xml' &&
      Object.entries(reviewed).every(([file, sha]) => {
        const b = read(file);
        return b && createHash('sha256').update(b).digest('hex') === sha;
      })
  };
}
