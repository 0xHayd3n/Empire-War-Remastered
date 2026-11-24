import * as THREE from 'three';
import { db } from '../gamedata.js';
import { wreckType, holdTicks, distance, boardingCraft } from './derelicttactical.js';
// Isolated scenery + controls for the one known survey beacon. Nothing is added
// to World.units, a player's reserve, targeting, fog sources or victory counts.
export function recoveryHUD(game, root) {
  const cb = game.setup.campaign,
    book = game.campaignBook,
    m = book.boarding;
  const prop = game.placeScenery({ type: db.type(wreckType), pos: [m.x, m.y, 0], rot: [12, 9, 42], scale: 1 });
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(distance - 5, distance, 80),
    new THREE.MeshBasicMaterial({ color: 0xeabb67, side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthWrite: false })
  );
  ring.position.set(m.x, m.y, 4);
  game.renderer.scene.add(ring);
  const box = document.createElement('div');
  box.className = 'recovery-beacon';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Derelict recovery');
  root.append(box);
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  box.append(status);
  const blocked = () =>
    game.modeSuspended ||
    game.over ||
    game.controlsLocked ||
    game.cine?.on ||
    game.tacticalCinematics?.on ||
    game.tacticalMovies?.active ||
    game.menus?.open ||
    game.retreat?.active ||
    game.tacticalVictory?.winner;
  function button(name, fn) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = name;
    b.addEventListener('click', () => {
      if (!blocked()) fn();
    });
    box.append(b);
    return b;
  }
  button('Locate wreck', () => {
    const rig = game.renderer.rig;
    rig.x = m.x;
    rig.y = m.y;
    rig.clamp();
  });
  const order = button('Plot boarding run', () => {
    const e = boardingCraft(cb, book);
    if (e && !m.void && m.ticks < holdTicks) game.command({ c: 'move', u: [e.id], x: m.x, y: m.y, attack: false, waypoint: false });
  });
  function update() {
    const e = boardingCraft(cb, book),
      dead = book.entity.get(cb.recovery.gid)?.dead;
    const text = m.void
      ? 'Recovery forgone'
      : dead
        ? 'Boarding ship lost or extracted'
        : m.ticks === holdTicks
          ? 'Prize secured · win with the crew alive'
          : !e
            ? 'Deploy the boarding corvette'
            : 'Derelict · ' + (m.ticks ? `boarding ${Math.ceil((holdTicks - m.ticks) / 30)}s` : 'hold inside the gold ring for 5s');
    if (status.textContent !== text) status.textContent = text;
    order.disabled = !e || m.void || m.ticks >= holdTicks || !!blocked();
  }
  update();
  return {
    update,
    dispose() {
      box.remove();
      prop.remove();
      ring.removeFromParent();
      ring.geometry.dispose();
      ring.material.dispose();
    }
  };
}
