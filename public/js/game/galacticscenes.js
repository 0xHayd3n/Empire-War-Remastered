export function placeGalacticModel(root, planet) {
  root.position.set(...planet.pos);
  root.rotation.set(0, 0, Math.PI / 2);
  root.scale.setScalar(planet.type.num('Scale_Factor', 1));
}

export function renderGalacticScenes(renderer, camera, main, background, midground, midforeground, detail = null) {
  const autoClear = renderer.autoClear,
    near = camera.near,
    far = camera.far;
  const restoreClip = () => {
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  };
  const distant = scene => {
    camera.near = 10;
    camera.far = 100000;
    camera.updateProjectionMatrix();
    if (detail) {
      scene.updateMatrixWorld();
      detail.draw(scene,camera,renderer.domElement.clientHeight || innerHeight,() => renderer.render(scene,camera));
    } else renderer.render(scene, camera);
    restoreClip();
  };
  const hold = 'holdResolve' in renderer,
    held = hold && renderer.holdResolve;
  try {
    renderer.autoClear = false;
    renderer.clear();
    // the main scene always draws last, so only its pass resolves the multisampled picture to the screen
    if (hold) renderer.holdResolve = true;
    if (background?.children.length) distant(background);
    renderer.clearDepth();
    if (midground?.children.length) distant(midground);
    if (midforeground?.children.length) distant(midforeground);
    if (hold) renderer.holdResolve = held;
    if (detail) detail.draw(main,camera,renderer.domElement.clientHeight || innerHeight,() => renderer.render(main,camera));
    else renderer.render(main, camera);
  } finally {
    if (camera.near !== near || camera.far !== far) restoreClip();
    if (hold) renderer.holdResolve = held;
    renderer.autoClear = autoClear;
  }
}
