// A solid broadcast from within the ring: front, back, beveled lip, and inside
// walls of the cutouts. Nothing is mapped onto a billboard. Keep depth testing
// so the character at the front can interrupt the projection.
import * as THREE from 'three';
import { commandColor } from './commandcolor.js';
export function commandHologram(scene, invalidate, library) {
  const mesh = new THREE.Group(),
    mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: true,
      side: THREE.FrontSide,
      uniforms: { tint: { value: new THREE.Color() }, clock: { value: 0 } },
      vertexShader: `attribute float signal; varying float strength; varying vec3 local,n,v;void main(){strength=signal; local=position;n=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(position,1.);v=-mv.xyz;gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `uniform vec3 tint;uniform float clock; varying float strength; varying vec3 local,n,v;
    void main(){vec3 N=normalize(n);float facing=abs(dot(N,normalize(v))); float rim=pow(1.-facing,1.6);
      float light=.5+.5*dot(N,normalize(vec3(-.6,.7,.55)));
      float line=local.y*110.-clock*.95;float band=.5+.5*cos(6.283185*line);band=mix(band,.5,smoothstep(.18,.70,fwidth(line)));
      float sweep=pow(.5+.5*cos(6.283185*(local.y*.85-clock*.19)),12.);
      float tip=smoothstep(.047,.057,abs(local.z));
      // Keep the projection in the same display space as the CSS faction gradient.
      vec3 srgb=mix(12.92*tint,1.055*pow(tint,vec3(1./2.4))-.055,step(vec3(.0031308),tint));
      float pitch=local.x*96.;float dots=(.5+.5*cos(6.283185*pitch))*(1.-smoothstep(.18,.7,fwidth(pitch)));
      vec3 col=mix(srgb,vec3(1.),.04+.19*rim+.04*tip+.12*sweep);
      gl_FragColor=vec4(col*(.42+.34*light+.26*band+.09*dots+.33*rim+.26*sweep)*(.47+.61*strength),(.52+.14*rim+.22*band+.10*sweep)*(.69+.31*strength));}`
    });
  let part,
    lease,
    key,
    seq = 0,
    time = 0,
    baseZ = 0.71;
  mesh.name = 'Solid command hologram';
  mesh.position.set(0, 0.48, baseZ);
  mesh.visible = false;
  scene.add(mesh);
  function release() {
    if (part) {
      mesh.remove(part);
      part = null;
    }
    lease?.release();
    lease = null;
    mesh.visible = false;
    delete mesh.userData.seat;
  }
  return {
    mesh,
    show(r) {
      if (key === r.key) return;
      release();
      key = r.key;
      const token = ++seq;
      lease = library.acquire(r);
      lease.ready.then(
        geo => {
          if (token !== seq) return;
          part = new THREE.Mesh(geo, mat);
          part.rotation.x = Math.PI / 2;
          mesh.add(part);
          mat.uniforms.tint.value.set(commandColor(r));
          mesh.visible = true;
          mesh.userData.seat = r.key;
          invalidate();
        },
        () => {}
      );
    },
    resize(aspect) {
      mesh.scale.setScalar(Math.min(0.74, aspect * 0.8));
    },
    tick(dt, reduced) {
      if (!reduced) time += dt;
      const t = reduced ? 0 : time;
      mesh.rotation.z = 0.42 + t * 0.6;
      mesh.rotation.y = 0.045 * Math.cos(t * 0.82);
      mesh.position.z = baseZ + 0.022 * Math.sin(t * 1.38);
      mat.uniforms.clock.value = t;
    },
    clear() {
      seq++;
      key = null;
      release();
    },
    dispose() {
      this.clear();
      mesh.removeFromParent();
      mat.dispose();
    }
  };
}
