// Reviewed GCCampaignLoaderCustom.Load_GC: choose only the layout and destination.
// Do not translate the custom campaign's subsequent location, roster or hero scripts.
export const fallCustomRevision = 'd0e2f9c8a2856f38eb5ff254e3cb43a29a00d77ccc6dc900b97b9af2213786d1';
const players = new Map([
  ['SANDBOX_CUSTOMLOADER_CIS', 'REBEL'],
  ['SANDBOX_CUSTOMLOADER_REPUBLIC', 'EMPIRE'],
  ['SANDBOX_CUSTOMLOADER_HUTTS', 'HUTT_CARTELS']
]);
const story = c => c.str('Underworld_Story_Name').replaceAll('\\', '/').trim().toUpperCase();
export function fallCustomLayouts(id, revision, loader, campaigns) {
  const player = players.get(loader.name.toUpperCase());
  if (
    id !== '1976399102' ||
    revision !== fallCustomRevision ||
    !player ||
    loader.str('Starting_Active_Player').toUpperCase() !== player ||
    loader.list('Locations').length !== 1 ||
    story(loader) !== 'CONQUESTS/CUSTOM/STORY_PLOTS_SANDBOX_LOADER_CUSTOM.XML'
  )
    return [];
  const targets = [];
  for (const size of ['', 'Small', 'Medium', 'Large', 'Influencers']) {
    const family = size ? `Sandbox_Custom_${size}` : 'Sandbox_Custom',
      c = campaigns.get(`${family}_${player}`.toUpperCase());
    if (
      !c ||
      c.str('Campaign_Set').toUpperCase() !== family.toUpperCase() ||
      c.str('Starting_Active_Player').toUpperCase() !== player ||
      c.bool('Is_Multiplayer') ||
      c.bool('Tutorial') ||
      c.bool('Is_Listed', true) ||
      c.list('Locations').length < 2 ||
      story(c) !== 'CONQUESTS/CUSTOM/STORY_PLOTS_SANDBOX_CUSTOM_CONTAINER.XML'
    )
      return [];
    targets.push({ c, button: 'Custom_GC_' + (size || 'FTGU_Layout') });
  }
  return targets;
}
