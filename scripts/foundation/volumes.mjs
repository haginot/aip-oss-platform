import {mkdtemp,mkdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
// Task-owned disk images only. Never detach or modify existing volumes.
export async function separateVolumes() {
 if(process.platform!=='darwin')throw Error('independent-volume harness requires macOS hdiutil; no directory fallback');
 const root=await mkdtemp(join(tmpdir(),'aip-volumes-')),mounts=[];
 const command=args=>execFileSync('hdiutil',args,{encoding:'utf8',timeout:30000});
 async function close(){for(const mount of mounts.reverse())command(['detach',mount]);await rm(root,{recursive:true,force:true});}
 try {
  for(const name of ['db','journal']) {
   const image=join(root,name+'.sparseimage'),mount=join(root,name);await mkdir(mount);
   command(['create','-size','512m','-type','SPARSE','-fs','APFS','-volname','AIP-'+name,'-o',image]);
   command(['attach',image,'-mountpoint',mount,'-nobrowse','-owners','on']);mounts.push(mount);
  }
  const [db,journal]=await Promise.all(mounts.map(path=>stat(path)));
  if(db.dev===journal.dev)throw Error('DB and journal must have distinct filesystem devices');
  return {db:mounts[0],journal:mounts[1],devices:{db:db.dev,journal:journal.dev},close};
 }catch(error){await close();throw error;}
}
