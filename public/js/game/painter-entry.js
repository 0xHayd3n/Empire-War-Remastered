// Keep the WebGL preview out of lobby/worker imports until someone opens the painter.
export async function showPainter(owner, faction) {
  const { openArmyPainter } = await import('./army-painter.js');
  return owner.isConnected && openArmyPainter({ owner, faction });
}

export function painterEntry(veil, factionOf = () => undefined) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'painter-entry';
  button.textContent = 'Army Painter';
  button.onclick = () => showPainter(veil, factionOf());
  veil.append(button);
}
