// Open the real stock 100-entry-per-side Instant Battle through the Universal setup.
module.exports = async function startFleet(frame, count = 100) {
  await frame.locator('body').evaluate(async (_, count) => {
    const { instantRoster, shipsOf, INSTANT_BUDGET_MAX: budget } = await import('/js/game/instantbattle.js');
    const players = ['Empire', 'Rebel'].map((faction, team) => {
      const rows = instantRoster(faction).filter(r => !r.hero),
        flagship = rows.find(r => shipsOf(r.type).some(t => /^(Generic_)?Star_Destroyer$/i.test(t.name))),
        escorts = rows.filter(r => r.cls >= 2 && r.cls <= 4),
        fighter = rows.find(r => r.cls === 0 || r.cls === 1);
      return {
        faction,
        team,
        budget,
        kind: team ? 'medium' : 'you',
        army: Array.from(
          { length: count },
          (_, i) => (!i && flagship ? flagship : i === 1 && fighter ? fighter : escorts[i % escorts.length]).name
        )
      };
    });
    localStorage.setItem('swr-instant-setup', JSON.stringify({ turn: 0, budget, players }));
  }, count);
  for (const id of ['TITLE_PLAY', 'IDC_INSTANT_BATTLE_BUTTON']) await frame.locator(`.title-menu [data-id="${id}"]`).click();
  const b = frame.locator('.op-setup');
  await b.getByRole('searchbox').fill('Abregado Rae Forces of Corruption space');
  await b.locator('[data-world="Abregado_Rae"][data-domain="space"][data-source="stock"]').first().click();
  await b.locator('.op-go').click();
  await frame.locator('#loading.hidden').waitFor({ state: 'attached' });
};
