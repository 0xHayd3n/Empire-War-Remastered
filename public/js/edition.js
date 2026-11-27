import {landPreview} from './endor-preview.js';
const KEY = 'swr.game';

export const EDITIONS = [
  { id: 'foc', name: 'Forces of Corruption' },
  { id: 'eaw', name: 'Empire at War' }
];

export function edition() {
  if(landPreview)return 'foc'; // fixed session only; preserve the user's launcher edition
  try {
    return localStorage.getItem(KEY) === 'eaw' ? 'eaw' : 'foc';
  } catch {
    return 'foc';
  }
}

export function setEdition(id) {
  try {
    if (id === 'eaw') localStorage.setItem(KEY, 'eaw');
    else localStorage.removeItem(KEY);
  } catch {}
}

export const expansion = () => edition() !== 'eaw';
