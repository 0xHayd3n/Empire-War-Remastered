// Verify a reviewed empty foliage inventory from the mounted scene. A desert or snow name alone is not a reason to return zero.
module.exports=function mountedBarren(){const g=game,r=reviewRecipe,s=g.ground.userData.reviewedLandscape,allowed=new Set(r.nonLivingProps),counts={};
 if(!s?.active||!allowed.size||Object.keys(r.retainedPlants||{}).length)throw Error('Missing pinned nonliving model inventory');
 for(const p of g.props){const m=p.modelFile.toUpperCase();if(!allowed.has(m))throw Error('Unclassified mounted prop: '+m);counts[m]=(counts[m]||0)+1;}
 if(Object.keys(counts).length!==allowed.size||s.grove||s.canopy)throw Error('Barren scene not as reviewed');
 const rim=g.scene.getObjectByName('Reviewed outskirts');if(!rim||!s.outskirts||rim.children.some(o=>o.name!=='Exterior terrain'))throw Error('Unexpected exterior objects in barren scene');
 return {drawn:s.outskirts.crowns,allocated:s.outskirts.stands,clearView:'command',models:counts};};
