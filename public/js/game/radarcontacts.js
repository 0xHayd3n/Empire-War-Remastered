// An alternative to the authored unit icons, not another source of contacts. Draw only
// after the minimap's visibility checks. Leave objective blips, pings and beacons alone.
export function contactSymbol(g, x, y, radius, friendly, neutral, color) {
  g.beginPath();
  if (neutral) g.rect(x - radius * 0.8, y - radius * 0.8, radius * 1.6, radius * 1.6);
  else if (friendly) g.arc(x, y, radius, 0, 2 * Math.PI);
  else {
    g.moveTo(x, y - radius * 1.2);
    g.lineTo(x + radius, y + radius * 0.85);
    g.lineTo(x - radius, y + radius * 0.85);
    g.closePath();
  }
  g.strokeStyle = '#10151c';
  g.lineWidth = Math.max(1, radius * 0.55);
  g.stroke();
  g.fillStyle = color;
  g.fill();
}
