// A selector needs the native rect, not the map's units/envs/embedded picture.
import assert from 'node:assert/strict';
const chunk = (type, data, container = false) => {
  const head = Buffer.alloc(8);
  head.writeUInt32LE(type);
  head.writeUInt32LE(data.length + (container ? 0x80000000 : 0), 4);
  return Buffer.concat([head, data]);
};
const vec = (tag, x, y) => {
  const mini = Buffer.alloc(14);
  mini.set([tag, 12]);
  mini.writeFloatLE(x, 2);
  mini.writeFloatLE(y, 6);
  return mini;
};
const data = Buffer.concat([
  chunk(0x13, Buffer.alloc(180000)),
  chunk(1, Buffer.concat([chunk(0x102, Buffer.alloc(40000), true), chunk(0x103, Buffer.concat([vec(4, -3200, -1500), vec(5, 6400, 2600)]))]), true)
]);
const reads = [];
globalThis.SWR_OVERLAY = { readPart: (_, start, length) => {
  reads.push(length);
  return Uint8Array.from(data.subarray(start, start + length)).buffer;
} };
const { loadSpaceBounds } = await import('../public/js/ted.js');
assert.deepEqual(await loadSpaceBounds('fixture.ted'), { min: { x: -3200, y: -1500 }, max: { x: 6400, y: 2600 } });
assert(reads.reduce((a, b) => a + b, 0) < 16000, 'skip the picture and object payloads');
console.log('Fleet preview bounds: asymmetric authored extents from small range reads.');
