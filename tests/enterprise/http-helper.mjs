export async function login(env,account='operator',mutate=x=>x){
 const r=await fetch(env.gateway.origin+'/login',{redirect:'manual'});const cookie=r.headers.get('set-cookie').split(';')[0],url=new URL(r.headers.get('location'));url.searchParams.set('account',account);
 const auth=await fetch(url,{redirect:'manual'});const callback=mutate(auth.headers.get('location'));
 const response=await fetch(callback,{redirect:'manual',headers:{cookie}});
 if(response.status!==302)return {response};
 const sessionCookie=response.headers.getSetCookie().find(x=>x.startsWith('enterprise_session=')).split(';')[0];
 const session=await fetch(env.gateway.origin+'/session',{headers:{cookie:sessionCookie}});const identity=await session.json();
 return {response,cookie:sessionCookie,identity,async api(operation,body={},key=crypto.randomUUID(),overrides={}){return fetch(env.gateway.origin+'/api',{method:'POST',headers:{cookie:sessionCookie,origin:env.gateway.origin,'x-csrf-token':identity.csrf,'content-type':'application/json',...overrides},body:JSON.stringify({contractVersion:'2.0.0',operation,body,key})});}};
}
