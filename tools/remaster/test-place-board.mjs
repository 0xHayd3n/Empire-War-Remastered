import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {placeBoard} from './place-board.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'place-board-'));
try {
 const dir=path.join(root,'references','reviewed-images');fs.mkdirSync(dir,{recursive:true});
 const views=Array.from({length:10},(_,i)=>{const bytes=Buffer.from(`reference fixture ${i}`),sha256=createHash('sha256').update(bytes).digest('hex');fs.writeFileSync(path.join(dir,sha256),bytes);return {sha256,page:'https://example.org/location',image:`https://lumiere-a.akamaihd.net/v1/images/test${i}.jpg?crop=2`,settingCue:`Dry slopes and skyline at location ${i}`,visible:'Rock and an open plain',subject:'landscape',people:'none'};});
 const d={job:'a'.repeat(64),planet:'Test world',views};assert(fs.readFileSync(placeBoard(d,root),'utf8').includes('Dry slopes and skyline at location 9'));
 assert.throws(()=>placeBoard({...d,views:[{...views[0],image:views[1].image+'4'},...views.slice(1)]},root),/Duplicate/);
 assert.throws(()=>placeBoard({...d,views:[{...views[0],sha256:views[1].sha256},...views.slice(1)]},root),/Duplicate/);
 const f=path.join(dir,views[0].sha256),mtime=fs.statSync(f).mtime;fs.writeFileSync(f,'alternate fixture 0');fs.utimesSync(f,mtime,mtime);assert.equal(placeBoard(d,root),null);fs.unlinkSync(f);assert.equal(placeBoard(d,root),null);
 console.log('PASS place board: inspected views reopen, alternate crops and identical bytes are rejected, changed same-size/mtime and missing images refuse reuse');
}finally{fs.rmSync(root,{recursive:true,force:true});}
