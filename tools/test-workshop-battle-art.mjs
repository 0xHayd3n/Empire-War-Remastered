import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { digest, photoKey, photoStore, stackKey } from './workshop-battle-art.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'exact-photo-'));
const map = 'DATA/ART/MAPS/PORT.TED', key = map.replaceAll('/', '\\');
const ted = Buffer.from('winning map'), image = Buffer.from('test photo bytes');
const entry = { meg:path.join(root,'maps.meg'), off:4, size:ted.length };
const game = {index:new Map([[key,entry]]), resolve:k=>k===map?key:null};
try {
  fs.writeFileSync(entry.meg, Buffer.concat([Buffer.alloc(4),ted,Buffer.alloc(3)]));
  const stack = stackKey(game,['A','B']);
  const row = {source:'reviewed-map-capture',map,kind:'land',planet:'Port',mapSHA:digest(ted),imageSHA:digest(image)};
  const catalog = photos=>fs.writeFileSync(path.join(root, stack+'.json'), JSON.stringify({version:1,stack,photos}));
  catalog([row]);
  fs.writeFileSync(path.join(root, row.imageSHA+'.jpg'),image);
  const photo = photoStore(root,stack,game);
  assert.deepEqual(await photo(key.toLowerCase(),'land','PORT'),{bytes:image,mapSHA:row.mapSHA});
  for (const args of [[map,'space','PORT'],[map,'land','Port II'],[map,'land',''],['DATA/CUSTOMMAPS/PORT.TED','land','Port'],['PORT.TED','land','Port']]) assert.equal(await photo(...args),null);
  assert.equal(photoKey('DATA/ART/MAPS/../PORT.TED','land','PORT'),null);
  assert.notEqual(stackKey(game,['B','A']),stack);
  assert.equal(await photoStore(root,stackKey(game,['B','A']),game)(map,'land','Port'),null);
  fs.utimesSync(entry.meg,new Date(1000),new Date(1000));assert.notEqual(stackKey(game,['A','B']),stack);
  game.index.set(key,{file:path.join(root,'loose.ted'),size:ted.length,mtimeMs:0});
  fs.writeFileSync(game.index.get(key).file,'another map');assert.equal(await photo(map,'land','Port'),null);
  fs.writeFileSync(game.index.get(key).file,ted);assert.deepEqual(await photo(map,'land','Port'),{bytes:image,mapSHA:row.mapSHA});
  catalog([row,row]);assert.equal(await photoStore(root,stack,game)(map,'land','Port'),null);
  fs.writeFileSync(path.join(root,row.imageSHA+'.jpg'),'changed photo');assert.equal(await photo(map,'land','Port'),null);
  fs.unlinkSync(path.join(root,row.imageSHA+'.jpg'));assert.equal(await photo(map,'land','Port'),null);
  console.log('Map photographs: exact mounted path, side, planet, layer order, revision, loose/MEG bytes, missing and ambiguous photos OK');
} finally { fs.rmSync(root, {recursive:true,force:true}); }
