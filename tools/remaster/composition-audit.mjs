import { patchMetrics } from './patch-metrics.mjs';
const unit = v => Number.isFinite(v) && v >= 0 && v <= 1;
export function validatePatchReview(c, brief) {
  if (
    !c?.design?.trim() ||
    !Array.isArray(c.evidence) ||
    new Set(c.evidence).size < 2 ||
    c.evidence.some(h => !brief.views.some(v => v.sha256 === h)) ||
    !Array.isArray(c.regions) ||
    c.regions.length < 2
  )
    throw Error('Need referenced multi-region composition');
  const views = new Set(),
    names = new Set();
  for (const r of c.regions) {
    if (
      !r.name?.trim() ||
      names.has(r.name) ||
      !/^[-a-z0-9]+$/.test(r.view) ||
      views.has(r.view) ||
      r.grid?.length !== 4 ||
      !r.grid.every(Number.isInteger) ||
      r.grid.some((k, i) => k < (i < 2 ? 0 : 2)) ||
      ![r.maxBoundary, r.maxSmallShare, r.maxJump].every(unit)
    )
      throw Error('Invalid patch control or thresholds');
    views.add(r.view);
    names.add(r.name);
  }
}
// The two entries are raw TED slots that route to different natural donors belonging
// to the same substrate. Mixing a road with a hillside is not material variation.
export function validateVariation(c,slots,brief){
  const v=c.variation;
  if(!v?.process?.trim()||!v.preserve?.trim())throw Error('Describe the local process and the boundary it must preserve');
  if(v.uniformReason?.trim()&&!v.pair && c.evidence.includes(v.evidence) && brief.views.some(f=>f.sha256===v.evidence))return;
  if(!Array.isArray(v.pair)||v.pair.length!==2||v.pair.some(i=>!Number.isInteger(i)||!c.channels.includes(i)||slots[i]?.use!=='natural')||slots[v.pair[0]].family===slots[v.pair[1]].family||!unit(v.minSpan)||v.minSpan<=0)throw Error('Review two distinct natural materials in the mantle, or cite a genuinely uniform surface');
}
// Low-frequency scan-color difference across neighboring vertices, not final shaded pixel contrast.
function jump(rgb, w, mask) {
  let total = 0,
    edges = 0,
    peak = 0;
  for (let i = 0; i < rgb.length; i++) {
    if (!mask[i]) continue;
    for (const j of [i % w ? i - 1 : -1, i - w])
      if (j >= 0 && mask[j]) {
        const d = Math.hypot(...rgb[i].map((x, k) => x - rgb[j][k])) / Math.sqrt(3);
        total += d;
        peak = Math.max(d, peak);
        edges++;
      }
  }
  return { mean: edges ? total / edges : null, peak, edges };
}
// Ratio in the uploaded, quantized cover texture, after excluding built corners, holes
// and vertices outside this substrate. Range alone would reward salt-and-pepper noise.
function rejectWallpaper(field,w,span){
  const h=field.length/w;
  // A slope or a single parallel ridge isn't wallpaper. Require a substantial
  // excursion at half a period AND a return to the starting mix twice in a row.
  for(const [dx,dy] of [[1,0],[0,1],[1,1],[-1,1]])for(let half=1;half<=12;half++){
    let excursion=0,returns=0,count=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const end=x+4*half*dx;if(end<0||end>=w||y+4*half*dy>=h)continue;
      const i=y*w+x,k=half*(dx+dy*w),a=field[i],b=field[i+k],c=field[i+2*k],d=field[i+4*k];
      if(Math.max(a,b,c,d)===255)continue;
      excursion+=(a-b)**2;returns+=((a-c)**2+(c-d)**2)*.5;count++;
    }
    if(count>=48 && excursion>count*(.25*254*span)**2 && returns<.045*excursion)throw Error(`Repeated ground-mix stripes at lag ${2*half} along ${dx},${dy}`);
  }
}
export function measureVariation(values,w){
  if(!Number.isInteger(w)||w<2||values.length%w||values.some(v=>v!==null&&!unit(v)))throw Error('Invalid substrate sample');
  const field=Buffer.alloc(values.length); // 255 is reserved for the exclusion mask
  for(let i=0;i<field.length;i++)field[i]=values[i]===null?255:Math.round(254*values[i]);
  const eligible=values.filter(Number.isFinite).sort((a,b)=>a-b),steps=[];
  const q=(a,p)=>a[Math.floor((a.length-1)*p)];
  for(let i=0;i<values.length;i++)if(Number.isFinite(values[i]))for(const j of [i%w?i-1:-1,i-w])if(j>=0 && Number.isFinite(values[j]))steps.push(Math.abs(values[i]-values[j]));
  if(eligible.length<32||steps.length<32)throw Error('Not enough connected natural ground for the variation check');
  steps.sort((a,b)=>a-b);return {eligible:eligible.length,pairs:steps.length,span:q(eligible,.9)-q(eligible,.1),step:q(steps,.9),field:field.toString('base64')};
}
export function summarizeField(r) {
  const [, , w, h] = r.grid,
    opts = { palette: r.palette, mask: r.mask };
  return {
    name: r.name,
    grid: r.grid,
    ...(r.substrate?.length?{variation:measureVariation(r.substrate,w)}:{}),
    prior: patchMetrics(r.prior, w, h, opts),
    modern: patchMetrics(r.modern, w, h, opts),
    jump: { prior: jump(r.oldRGB, w, r.mask), modern: jump(r.rgb, w, r.mask) }
  };
}
export function checkComposition(review, report) {
  const audits = report.patchAudit;
  if (!Array.isArray(audits) || audits.length !== review.regions.length) throw Error('Need mounted patch and blend audit');
  for (const region of review.regions) {
    const a = audits.find(a => a.name === region.name);
    if(review.variation?.pair){const v=a?.variation;if(!v||!Number.isInteger(v.eligible)||v.eligible<32||v.eligible>region.grid[2]*region.grid[3]||!Number.isInteger(v.pairs)||v.pairs<32||!unit(v.span)||v.span<review.variation.minSpan||!unit(v.step)||v.step>v.span*.6)throw Error('Uniform or speckled natural substrate in '+region.name);
      const raw=Buffer.from(v.field||'','base64');if(raw.length!==region.grid[2]*region.grid[3]||raw.filter(b=>b!==255).length!==v.eligible)throw Error('Missing or mismatched within-substrate samples');
      const replay=measureVariation(Array.from(raw,b=>b===255?null:b/254),region.grid[2]);if(replay.pairs!==v.pairs||Math.abs(replay.span-v.span)>1/254+.00001||Math.abs(replay.step-v.step)>1/254+.00001)throw Error('Within-substrate spread does not match the mounted rows');rejectWallpaper(raw,region.grid[2],v.span);
    }
    const
      m = a?.modern,
      p = a?.prior;
    if (
      !m ||
      !p ||
      String(a.grid) !== String(region.grid) ||
      !report.views[region.view] ||
      !(p.adjacency.edges > 0) ||
      m.adjacency.edges !== p.adjacency.edges ||
      m.included !== p.included ||
      !(m.materials.distinct >= (region.uniformReason?.trim() ? 1 : 2)) ||
      ![p.adjacency.fraction, m.adjacency.fraction, m.patches.smallVertexFraction, a.jump?.prior?.mean, a.jump?.modern?.mean].every(unit) ||
      m.adjacency.fraction > region.maxBoundary ||
      m.patches.smallVertexFraction > region.maxSmallShare ||
      a.jump.modern.mean > region.maxJump ||
      a.replay?.match !== true ||
      !Number.isInteger(a.replay.changed) ||
      a.replay.changed < (region.retainReason?.trim() ? 0 : 1)
    )
      throw Error('Missing layout replay, flattened palette or abrupt ground transitions: ' + region.name);
  }
  return audits;
}
