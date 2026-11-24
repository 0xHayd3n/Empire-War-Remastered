export const flagshipName = 'Flagship Valiant';
export function conditionLabel(c) {
  if (!c) return 'full hull and hardpoints';
  const damaged = c.parts.filter(([, v]) => v < 1).length;
  return `${Math.floor(c.hull * 100)}% hull · ${damaged} damaged hardpoint${damaged === 1 ? '' : 's'}`;
}
