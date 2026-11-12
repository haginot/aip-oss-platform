// Data-only lock graph prerequisite. Callers must authenticate the lock bytes.
// This does NOT verify semver satisfaction, platform selection, package archives,
// installed files or provenance. No graph result is an initializer authority.
import assert from 'node:assert/strict';
const namePattern=/^(?:@[a-zA-Z0-9_~-][a-zA-Z0-9._~-]*\/)?[a-zA-Z0-9_~-][a-zA-Z0-9._~-]*$/;
const locationPattern=/^node_modules\/(?:@[a-zA-Z0-9_~-][a-zA-Z0-9._~-]*\/)?[a-zA-Z0-9_~-][a-zA-Z0-9._~-]*(?:\/node_modules\/(?:@[a-zA-Z0-9_~-][a-zA-Z0-9._~-]*\/)?[a-zA-Z0-9_~-][a-zA-Z0-9._~-]*)*$/;
const own=(o,k)=>Object.hasOwn(o,k);
const object=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
const check=(condition,locator,reason)=>assert.ok(condition,`dependency graph ${locator}: ${reason}`);
function declarations(value,locator){
 if(value===undefined)return {};
 check(object(value),locator,'dependency map required');
 for(const [name,spec] of Object.entries(value)){
  check(namePattern.test(name),locator,'invalid dependency name '+name);
  check(typeof spec==='string'&&spec.length>0&&spec.trim()===spec,locator,'invalid dependency spec '+name);
 }
 return value;
}
function parent(location){const i=location.lastIndexOf('/node_modules/');return i<0?'':location.slice(0,i);}
function candidates(from,name,peer){
 const result=[];let scope=peer?parent(from):from;
 for(;;){result.push((scope?scope+'/':'')+'node_modules/'+name);if(!scope)break;scope=parent(scope);}
 return result;
}
export function assessDependencyGraph(lock,rootLocation='node_modules/takt'){
 check(object(lock)&&lock.lockfileVersion===3,'lock','unsupported lockfile version');
 check(object(lock.packages),'lock/packages','package locations required');
 check(locationPattern.test(rootLocation),rootLocation,'noncanonical root location');
 for(const location of Object.keys(lock.packages))check(location===''||locationPattern.test(location),'lock/packages/'+location,'unsupported package location');
 const packages=[],edges=[],unresolved=[],seen=new Set(),queue=[rootLocation];
 for(let i=0;i<queue.length;i++){
  const location=queue[i];if(seen.has(location))continue;seen.add(location);
  const pkg=lock.packages[location];check(object(pkg),location,'missing package metadata');
  check(pkg.link===undefined||pkg.link===false,location,'unsupported link');
  check(typeof pkg.version==='string'&&pkg.version.length>0,location,'version required');
  const deps=declarations(pkg.dependencies,location+'/dependencies'),optional=declarations(pkg.optionalDependencies,location+'/optionalDependencies'),peers=declarations(pkg.peerDependencies,location+'/peerDependencies');
  const meta=pkg.peerDependenciesMeta??{};check(object(meta),location+'/peerDependenciesMeta','metadata map required');
  for(const [name,m] of Object.entries(meta))check(own(peers,name)&&object(m)&&Object.keys(m).every(k=>k==='optional')&&(m.optional===undefined||typeof m.optional==='boolean'),location+'/peerDependenciesMeta/'+name,'unsupported peer metadata');
  const platform={};
  for(const field of ['os','cpu','libc'])if(pkg[field]!==undefined){check(Array.isArray(pkg[field])&&pkg[field].length>0&&pkg[field].every(v=>typeof v==='string'&&/^!?[a-zA-Z0-9_-]+$/.test(v)),location+'/'+field,'unsupported platform metadata');platform[field]=[...pkg[field]];}
  const bundled=pkg.bundleDependencies??pkg.bundledDependencies??[];
  check(Array.isArray(bundled)&&new Set(bundled).size===bundled.length&&bundled.every(n=>namePattern.test(n)&&(own(deps,n)||own(optional,n))),location+'/bundleDependencies','unsupported bundled dependencies');
  if(pkg.bundleDependencies!==undefined&&pkg.bundledDependencies!==undefined)check(JSON.stringify(pkg.bundleDependencies)===JSON.stringify(pkg.bundledDependencies),location,'conflicting bundled metadata');
  packages.push({path:location,version:pkg.version,...(pkg.resolved===undefined?{}:{resolved:pkg.resolved}),...(pkg.integrity===undefined?{}:{integrity:pkg.integrity}),inBundle:pkg.inBundle===true,bundled:[...bundled],platform});
  const requirements=[...Object.entries({...deps,...optional}).map(([name,spec])=>({name,spec,kind:own(optional,name)?'optional':'dependency',optional:own(optional,name)})),...Object.entries(peers).map(([name,spec])=>({name,spec,kind:'peer',optional:meta[name]?.optional===true}))];
  for(const r of requirements){
   const searched=candidates(location,r.name,r.kind==='peer'),to=searched.find(p=>own(lock.packages,p));
   const edge={from:location,...r,to:to??null,searched};edges.push(edge);
   if(!to){check(r.optional,location,'unresolved '+r.kind+' '+r.name+' searched '+searched.join(','));unresolved.push({...edge,reason:'OPTIONAL_SELECTION_UNPROVEN'});}
   else queue.push(to);
  }
 }
 return {kind:'HISTORICAL_LOCK_GRAPH_ASSESSMENT',rootLocation,packages:packages.sort((a,b)=>a.path.localeCompare(b.path,'en')),edges,unresolved,
  platformSelectionProven:false,versionConstraintsProven:false,dependencyClosureIntegrityProven:false,completeMigrationHistory:false,initializationAuthority:false,currentApprovals:[]};
}
