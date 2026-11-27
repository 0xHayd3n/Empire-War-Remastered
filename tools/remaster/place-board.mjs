// Reopen the inspected evidence for this exact brief, not a fresh set of narrative
// thumbnails. Verify private bytes on every reuse; a changed/deleted still is a miss.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {inspectPlaceViews} from './place-evidence.mjs';
const esc=s=>String(s).replace(/[&<>"']/g,k=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[k]));
export function placeBoard(d,home){
 inspectPlaceViews(d);if(!/^[a-f0-9]{64}$/.test(d.job))throw Error('Unbound place board');const root=path.join(home,'references'),cards=[];
 for(const v of d.views){if(!/^[a-f0-9]{64}$/.test(v.sha256)||new URL(v.page).protocol!=='https:')throw Error('Unpinned place reference');const f=path.join(root,'reviewed-images',v.sha256);if(!fs.existsSync(f)||createHash('sha256').update(fs.readFileSync(f)).digest('hex')!==v.sha256)return null;
 cards.push(`<figure><a href="${esc(v.page)}"><img loading="lazy" src="${esc(pathToFileURL(f).href)}" alt="${esc(v.visible)}"></a><figcaption><b>${esc(v.subject)}</b> · ${esc(v.settingCue)} <a href="${esc(v.page)}">Source</a></figcaption></figure>`);}
 const board=path.join(root,'by-job',d.job+'-places.html');fs.mkdirSync(path.dirname(board),{recursive:true});fs.writeFileSync(board,`<!doctype html><meta charset=utf-8><title>${esc(d.planet)} · inspected places</title><style>body{font:15px system-ui;color:#eee;background:#242628}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}figure{margin:0}img{width:100%;aspect-ratio:16/10;object-fit:contain}a{color:#9cd5f2}</style><h1>${esc(d.planet)} · inspected places</h1><p>Location evidence, not runtime art. Real-world analogues are identified in the notes.</p><section>${cards.join('')}</section>`);return board;
}
