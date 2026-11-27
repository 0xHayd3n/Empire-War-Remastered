// Code-only distribution; never scan a game, mod, generated folder, or the private library.
import fs from 'node:fs';
import { storeZip } from '../public/js/texture-showcase/archive.js';
const root = new URL('../', import.meta.url),
  files = [
    'LICENSE',
    'tools/texture-showcase-cli.mjs',
    'tools/megfs.mjs',
    'public/js/language.js',
    'public/js/localizedmedia.js',
    'public/js/ddsmips.js',
    'public/js/ddsdecode.js',
    ...['recipes', 'archive', 'build', 'enhance', 'refit', 'forest'].map(n => 'public/js/texture-showcase/' + n + '.js')
  ];
const entries = [
  ['README.md', fs.readFileSync(new URL('docs/texture-showcase.md', root))],
  ['package.json', Buffer.from('{"private":true,"type":"module"}\n')],
  ...files.map(file => [file, fs.readFileSync(new URL(file, root))])
];
const zip = storeZip(entries);
fs.mkdirSync(new URL('public/downloads/', root), { recursive: true });
fs.writeFileSync(new URL('public/downloads/texture-showcase-builder.zip', root), zip);
console.log('Code-only builder:', zip.length, 'bytes');
