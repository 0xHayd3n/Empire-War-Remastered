import { findFiles } from '../vfs.js';
import { activeLanguage, LANGUAGES, languageId } from '../language.js';
import { switchLanguage } from '../gamedata.js';
import { group, select, remember } from './settingsfields.js';
import { el } from './commandui.js';
const names = ['English', 'Deutsch', 'Français', 'Español', 'Italiano', '日本語', '한국어', '中文', 'Русский', 'Polski', 'ไทย'];
export async function languageControl(parent, signal) {
  const g = group(parent, 'Mounted game language');
  try {
    const files = await findFiles('(?:^|[\\\\/])MASTERTEXTFILE_[A-Z]+\\.DAT$');
    if (signal.aborted) return;
    const ids = new Set(files.map(s => languageId(/MASTERTEXTFILE_([A-Z]+)\.DAT$/i.exec(s)?.[1])).filter(n => n !== null));
    if (!ids.size) {
      g.append(el('p', '', 'No installed text languages found.'));
      return;
    }
    const note = el('p', 'us-help', 'Applies to mounted game text and available localized media. Universal menus may remain in English.');
    const input = select(
      g,
      'Game language',
      LANGUAGES.flatMap((_, i) => (ids.has(i) ? [[i, names[i]]] : [])),
      activeLanguage,
      async v => {
        input.disabled = true;
        try {
          const applied = await switchLanguage(v);
          remember('swr-game-language', applied);
          input.value = applied;
        } catch {
          input.value = activeLanguage;
          note.textContent = 'The language could not be loaded completely.';
        } finally {
          input.disabled = ids.size === 1;
        }
      }
    );
    input.disabled = ids.size === 1;
    g.append(note);
  } catch {
    if (!signal.aborted) g.append(el('p', '', 'Could not list the installed game languages.'));
  }
}
