import assert from 'node:assert/strict';
import { sceneryRole, naturalSlot } from '../public/js/scenery-surface.js';
import { sceneryLevel } from '../public/js/game/scenery-lod.js';
for (const [type, file, expected] of [
  ['Prop_Rock_Cluster_02', 'W_ROCKCLSTR02.ALO', 'stone'],
  ['', 'W_TempRockClstr02.ALO', 'stone'],
  ['Prop_Tatooine_Tree00', 'W_Tree_Tat00.ALO', 'vegetation'],
  ['', 'W_Bush_Tat02.ALO', 'vegetation'],
  ['Prop_Rocket_Tower', 'W_RocketTurret.ALO', ''],
  ['', 'W_UrbanStreetLite.ALO', ''],
  ['Prop_Ice_Cliff', 'W_IceRock.ALO', '']
])
  assert.equal(sceneryRole(type, file), expected);
const infer = (model, shader, texture, hint) => naturalSlot(sceneryRole('Prop_27', model, hint), shader, texture);
for (const [model, shader, texture, want] of [
  ['asset17.alo', 'grass.fx', 'atlas_A.tga', 'vegetation'],
  ['asset18.alo', 'tree.fx', 'atlas_B.tga', 'vegetation'],
  ['asset19.alo', 'batchmeshalpha.fx', 'W_EndrLeaf00.tga', 'vegetation'],
  ['asset20.alo', 'terrainmeshbump.fx', 'W_TatRock01.tga', 'stone'],
  ['asset21.alo', 'mesh.fx', 'Basalt.tga', 'stone'],
  ['W_ENDRROCKCLSTR01.ALO', 'batchmeshgloss.fx', 'W_Mnt_Temp01.tga', 'stone'],
  ['asset22.alo', 'mesh.fx', 'atlas_C.tga', ''],
  ['W_HothDoors.alo', 'mesh.fx', 'W_Rock00.tga', ''],
  ['W_SandStorm00.alo', 'meshgloss.fx', 'W_TatRock01.tga', ''],
  ['W_SithStatue.alo', 'meshgloss.fx', 'Temperate_Cliff.tga', ''],
  ['terrain.alo', 'mesh.fx', 'Rock_Panel.tga', ''],
  ['W_SwampVine00.alo', 'meshalpha.fx', 'W_SwampGrass00.tga', 'vegetation'],
  ['W_GrndCvr_D.alo', 'grass.fx', 'W_GrndCvr03.tga', 'vegetation']
])
  assert.equal(infer(model, shader, texture), want, `${model}/${texture}`);
assert.equal(infer('asset23.alo', 'grass.fx', 'atlas_B.tga', 'authored'), '');
assert.equal(infer('asset24.alo', 'mesh.fx', 'basalt.tga', 'unknown-override'), '');
assert.equal(sceneryRole('Prop', 'alien.alo', ' stone '), 'stone');
assert.equal(sceneryRole('Prop_Rock', 'rock.alo', 'authored'), '');
for (const [shader, map, expected] of [
  ['batchmeshgloss.fx', 'Rock.tga', 'stone'],
  ['meshreflect.fx', 'Rock.tga', ''],
  ['meshgloss.fx', 'Cliff_window.tga', ''],
  ['meshadditive.fx', 'Lava.tga', '']
])
  assert.equal(naturalSlot('stone', shader, map), expected);
assert.equal(sceneryLevel(102, 0), 0);
assert.equal(sceneryLevel(102, 1), 1);
assert.equal(sceneryLevel(36, 1), 1);
assert.equal(sceneryLevel(36, 2), 2);
assert.equal(sceneryLevel(190, 2), 0);
console.log('Scenery roles, authored exceptions and projected-size hysteresis: passed');
