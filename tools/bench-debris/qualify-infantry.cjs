// Serial runs only: don't let two Chromium instances contend for the same GPU.
// Each run opens mounted Universal in a fresh disposable profile. Keep failures;
// one red visual gate must not silently drop an engine from the perf comparison.
const {spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve(process.argv[2]||path.join(__dirname,'infantry-evidence'));fs.mkdirSync(out,{recursive:true});
const runs=[['quality',[]],['pile',['--n=24']],['churn',['--suite=soak']],...['rapier','jolt'].flatMap(first=>[
 [`six-${first}`,['--suite=perf','--n=6',`--first=${first}`]],
 [`crowd-${first}`,['--suite=perf',`--first=${first}`]],
 [`live-${first}`,['--suite=perf','--live=1',`--first=${first}`]],
 [`cpu-${first}`,['--suite=perf','--cpu=4',`--first=${first}`]]])];
let failed=0;for(const [tag,args] of runs){const file=path.join(out,`joint-${tag}.json`);const r=spawnSync(process.execPath,[path.join(__dirname,'infantry.cjs'),...args,`--out=${file}`],{encoding:'utf8',windowsHide:true,timeout:200000});
 if(r.error||r.status!==0){failed++;console.error(tag,r.error?.message||r.stderr?.slice(-600));}if(r.stdout)for(const line of r.stdout.split('\n').filter(l=>l.startsWith('[infantry]')))console.log(tag,line);
}process.exitCode=failed?1:0;
