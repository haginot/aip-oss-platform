// Read-only prerequisite over authenticated lock data. Deliberately supports
// stable full X.Y.Z ranges only: exact, < <= > >=, ^, ~, *, AND and OR.
// Short versions, prerelease/build, aliases, URLs and other npm syntax refuse.
// No metadata, installation, platform or execution-origin proof is inferred.
import assert from 'node:assert/strict';
import {assessDependencyGraph} from './runtime-dependency-graph.mjs';
const check=(ok,where,reason)=>assert.ok(ok,`version constraint ${where}: ${reason}`);
function version(raw,where){
 check(typeof raw==='string'&&raw.length<=64&&/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(raw),where,'unsupported stable version');
 const parts=raw.split('.').map(Number);check(parts.every(Number.isSafeInteger),where,'unsupported version integer');return parts.map(BigInt);
}
function compare(a,b){for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]<b[i]?-1:1;return 0;}
function range(raw,where){
 check(typeof raw==='string'&&raw.length>0&&raw.length<=4096&&raw.trim()===raw&&!/[\r\n\t]/.test(raw),where,'unsupported range');
 // Parse every branch before evaluating, so a wildcard cannot hide bad syntax.
 return raw.split('||').map(branch=>{
  const text=branch.trim();check(text.length>0,where,'unsupported empty range branch');
  return text.split(/ +/).map(token=>{
   if(token==='*')return ()=>true;
   const m=/^(>=|<=|>|<|=|\^|~)?([0-9]+\.[0-9]+\.[0-9]+)$/.exec(token);check(m,where,'unsupported range token '+token);
   const op=m[1]??'=',v=version(m[2],where);
   if(op==='^'||op==='~'){
    const upper=op==='~'?[v[0],v[1]+1n,0n]:v[0]>0n?[v[0]+1n,0n,0n]:v[1]>0n?[0n,v[1]+1n,0n]:[0n,0n,v[2]+1n];
    return actual=>compare(actual,v)>=0&&compare(actual,upper)<0;
   }
   return actual=>{const c=compare(actual,v);return op==='='?c===0:op==='>'?c>0:op==='>='?c>=0:op==='<'?c<0:c<=0;};
  });
 });
}
export function assessDependencyVersionConstraints(lock,rootLocation='node_modules/takt'){
 const graph=assessDependencyGraph(lock,rootLocation),versions=new Map(graph.packages.map(p=>[p.path,version(p.version,p.path)])),checks=[];
 for(const e of graph.edges){
  const where=e.from+'/'+e.kind+'/'+e.name,sets=range(e.spec,where);
  if(e.to===null)continue; // Optional absence remains an explicit obligation below.
  const actual=versions.get(e.to);check(actual,where,'resolved version unavailable '+e.to);
  check(sets.some(set=>set.every(test=>test(actual))),where,'unsatisfied '+e.spec+' by '+lock.packages[e.to].version+' at '+e.to);
  checks.push({...e,version:lock.packages[e.to].version,satisfied:true});
 }
 return {kind:'HISTORICAL_STABLE_VERSION_CONSTRAINT_ASSESSMENT',scope:'STABLE_FULL_VERSION_RANGE_SUBSET',rootLocation,checks,unresolved:graph.unresolved,
  resolvedConstraintsSatisfied:true,versionConstraintsProven:graph.unresolved.length===0,platformSelectionProven:false,dependencyClosureIntegrityProven:false,completeMigrationHistory:false,initializationAuthority:false,currentApprovals:[]};
}
