import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from './worker.mjs';
const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
function prepared(sql,values=[]){return {sql,values,bind(...v){return prepared(sql,v)},async first(){return db.prepare(sql).get(...values)||null},async all(){return {results:db.prepare(sql).all(...values)}},async run(){const r=db.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}}}}}
const env={ADMIN_TOKEN:'test-admin-key-not-for-production-very-long',ALLOWED_ORIGINS:'https://yilis2716-create.github.io',MEMORY_DB:{prepare:prepared,async batch(items){db.exec('BEGIN');try{const r=items.map(x=>({results:db.prepare(x.sql).all(...x.values),meta:{changes:db.prepare('SELECT changes() AS n').get().n}}));db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}}};
const origin='https://memory.example',redirect='https://chatgpt.com/connector_platform_oauth_redirect',resource=origin+'/mcp';
async function req(path,{method='GET',json,form,headers={}}={}){const h={...headers};let body;if(json!==undefined){body=JSON.stringify(json);h['Content-Type']='application/json'}if(form!==undefined){body=new URLSearchParams(form).toString();h['Content-Type']='application/x-www-form-urlencoded'}const r=await worker.fetch(new Request(origin+path,{method,headers:h,...(body!==undefined?{body}:{})}),env);const text=await r.text();let data;try{data=JSON.parse(text)}catch{}return {r,status:r.status,text,data}}
const admin={Authorization:'Bearer '+env.ADMIN_TOKEN};
const a=(await req('/api/roles',{method:'POST',headers:admin,json:{name:'测试角色 A'}})).data;
const b=(await req('/api/roles',{method:'POST',headers:admin,json:{name:'测试角色 B'}})).data;
let n=0;const eq=(a,b)=>{assert.deepEqual(a,b);n++};const ok=v=>{assert(v);n++};
const meta=await req('/.well-known/oauth-authorization-server');eq(meta.status,200);eq(meta.data.issuer,origin);ok(meta.data.code_challenge_methods_supported.includes('S256'));eq(meta.data.token_endpoint_auth_methods_supported,['none']);eq(meta.data.authorization_response_iss_parameter_supported,true);
eq((await req('/.well-known/oauth-protected-resource/mcp')).data.resource,resource);
const noauth=await req('/mcp');eq(noauth.status,401);ok(noauth.r.headers.get('WWW-Authenticate').includes('/.well-known/oauth-protected-resource/mcp'));
eq((await req('/mcp',{headers:{Authorization:'Bearer '+a.access_token}})).status,401);
eq((await req('/oauth/register',{method:'POST',json:{redirect_uris:['https://attacker.example/callback']}})).status,400);
eq((await req('/oauth/register',{method:'POST',json:{redirect_uris:['https://chatgpt.com.attacker.example/connector_platform_oauth_redirect']}})).status,400);
eq((await req('/oauth/register',{method:'POST',json:{redirect_uris:['https://chatgpt.com/connector_platform_oauth_redirect?bad=1']}})).status,400);
eq((await req('/oauth/register',{method:'POST',json:{redirect_uris:[redirect],token_endpoint_auth_method:'client_secret_basic'}})).status,400);
const registered=await req('/oauth/register',{method:'POST',json:{redirect_uris:[redirect],token_endpoint_auth_method:'none'}});eq(registered.status,201);const client=registered.data.client_id;
const verifier='v'.repeat(43),challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
const params={response_type:'code',client_id:client,redirect_uri:redirect,resource,scope:'memory:read memory:write',state:'random-state-value',code_challenge:challenge,code_challenge_method:'S256'};
const url=p=>'/oauth/authorize?'+new URLSearchParams(p);
eq((await req(url({...params,redirect_uri:'https://attacker.example'}))).status,400);
eq((await req(url({...params,resource:origin+'/mcp/other'}))).status,400);
eq((await req(url({...params,code_challenge_method:'plain'}))).status,400);
eq((await req(url({...params,state:''}))).status,400);
eq((await req(url({...params,scope:'admin'}))).status,400);
function formInfo(r){const context=r.text.match(/name="context" value="([^"]+)"/)[1];return {context,cookie:r.r.headers.get('set-cookie').split(';')[0]}}
async function page(scope=params.scope){const p=await req(url({...params,scope}));eq(p.status,200);ok(p.r.headers.get('Content-Security-Policy').includes("frame-ancestors 'none'"));ok(p.r.headers.get('set-cookie').includes('HttpOnly'));ok(!p.text.includes(a.access_token));return formInfo(p)}
const first=await page();
eq((await req('/oauth/authorize',{method:'POST',form:{context:first.context,role_id:a.id,role_key:a.access_token,decision:'allow'}})).status,403);
eq((await req('/oauth/authorize',{method:'POST',headers:{Cookie:first.cookie,Origin:'https://attacker.example'},form:{context:first.context,role_id:a.id,role_key:a.access_token,decision:'allow'}})).status,403);
eq((await req('/oauth/authorize',{method:'POST',headers:{Cookie:first.cookie},form:{context:first.context+'x',role_id:a.id,role_key:a.access_token,decision:'allow'}})).status,400);
const wrong=await req('/oauth/authorize',{method:'POST',headers:{Cookie:first.cookie},form:{context:first.context,role_id:a.id,role_key:env.ADMIN_TOKEN,decision:'allow'}});eq(wrong.status,403);ok(!wrong.text.includes(env.ADMIN_TOKEN));
async function authorize(scope=params.scope,role=a){const p=await page(scope);const r=await req('/oauth/authorize',{method:'POST',headers:{Cookie:p.cookie,Origin:origin},form:{context:p.context,role_id:role.id,role_key:role.access_token,decision:'allow'}});eq(r.status,303);const callback=new URL(r.r.headers.get('location'));eq(callback.origin,'https://chatgpt.com');eq(callback.searchParams.get('state'),params.state);eq(callback.searchParams.get('iss'),origin);ok(!callback.href.includes(role.access_token));return {code:callback.searchParams.get('code'),page:p}}
const flow=await authorize();
eq((await req('/oauth/authorize',{method:'POST',headers:{Cookie:flow.page.cookie},form:{context:flow.page.context,role_id:a.id,role_key:a.access_token,decision:'allow'}})).status,400);
const codeForm={grant_type:'authorization_code',client_id:client,redirect_uri:redirect,resource,code:flow.code,code_verifier:verifier};
eq((await req('/oauth/token',{method:'POST',form:{...codeForm,code_verifier:'z'.repeat(43)}})).status,400);
eq((await req('/oauth/token',{method:'POST',form:{...codeForm,redirect_uri:redirect+'/wrong'}})).status,400);
eq((await req('/oauth/token',{method:'POST',form:{...codeForm,resource:origin}})).status,400);
const issued=await req('/oauth/token',{method:'POST',form:codeForm});eq(issued.status,200);eq(issued.data.token_type,'Bearer');eq(issued.data.expires_in,3600);eq(db.prepare('SELECT COUNT(*) AS n FROM oauth_sessions').get().n,1);
eq((await req('/oauth/token',{method:'POST',form:codeForm})).status,400);
let access=issued.data.access_token,refresh=issued.data.refresh_token;
const call=(name,args={},bearer=access)=>req('/mcp',{method:'POST',headers:{Authorization:'Bearer '+bearer},json:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}});
const listed=await req('/mcp',{method:'POST',headers:{Authorization:'Bearer '+access},json:{jsonrpc:'2.0',id:1,method:'tools/list'}});eq(listed.data.result.tools.length,3);eq(listed.data.result.tools.find(t=>t.name==='memory_profile')._meta['openai/profile'],true);
eq((await call('memory_profile')).data.result.structuredContent.id,a.id);
const saved=await call('memory_save',{content:'OAuth 授权测试：喜欢蓝粉界面',title:'界面偏好',role_id:b.id});eq(saved.data.result.structuredContent.ok,true);
eq((await req('/api/roles/'+b.id+'/search',{method:'POST',headers:{Authorization:'Bearer '+b.access_token},json:{query:'OAuth'}})).data.returned,0);
eq((await call('memory_search',{query:'OAuth'})).data.result.structuredContent.returned,1);
eq((await req('/api/roles/'+a.id+'/search',{method:'POST',headers:{Authorization:'Bearer '+access},json:{query:'OAuth'}})).status,403);
const rawRows=JSON.stringify(db.prepare('SELECT * FROM oauth_sessions').all());ok(!rawRows.includes(access));ok(!rawRows.includes(refresh));ok(!rawRows.includes(a.access_token));ok(!JSON.stringify(db.prepare('SELECT * FROM oauth_codes').all()).includes(flow.code));
const refreshed=await req('/oauth/token',{method:'POST',form:{grant_type:'refresh_token',client_id:client,resource,refresh_token:refresh}});eq(refreshed.status,200);eq((await call('memory_profile',{},access)).status,401);access=refreshed.data.access_token;eq((await call('memory_profile')).status,200);
const reused=await req('/oauth/token',{method:'POST',form:{grant_type:'refresh_token',client_id:client,resource,refresh_token:refresh}});eq(reused.status,400);eq((await call('memory_profile')).status,401);
// Read-only scope cannot invoke saves even if it supplies hidden tool names.
const ro=await authorize('memory:read'),roToken=(await req('/oauth/token',{method:'POST',form:{...codeForm,code:ro.code}})).data.access_token;
eq((await call('memory_search',{query:'OAuth'},roToken)).data.result.structuredContent.ok,true);eq((await call('memory_save',{content:'forbidden'},roToken)).data.result.isError,true);
// Expired access tokens and expired authorization codes are rejected.
db.prepare('UPDATE oauth_sessions SET access_expires=0 WHERE access_hash=?').run(Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(roToken))).toString('base64url'));eq((await call('memory_profile',{},roToken)).status,401);
const expired=await authorize();db.prepare('UPDATE oauth_codes SET expires_at=0 WHERE hash=?').run(Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(expired.code))).toString('base64url'));eq((await req('/oauth/token',{method:'POST',form:{...codeForm,code:expired.code}})).status,400);
// A registered second client cannot redeem the first client's grant.
const client2=(await req('/oauth/register',{method:'POST',json:{redirect_uris:[redirect]}})).data.client_id;
const cross=await authorize();eq((await req('/oauth/token',{method:'POST',form:{...codeForm,code:cross.code,client_id:client2}})).status,400);
// Two concurrent redemptions issue exactly one token set.
const race=await authorize();const raced=await Promise.all([req('/oauth/token',{method:'POST',form:{...codeForm,code:race.code}}),req('/oauth/token',{method:'POST',form:{...codeForm,code:race.code}})]);eq(raced.map(r=>r.status).sort(),[200,400]);access=raced.find(r=>r.status===200).data.access_token;
// OAuth session termination is not authorization revocation.
eq((await req('/mcp',{method:'DELETE',headers:{Authorization:'Bearer '+access}})).status,204);eq((await call('memory_profile')).status,200);
// Explicit revocation works.
await req('/oauth/revoke',{method:'POST',form:{client_id:client,token:access}});eq((await call('memory_profile')).status,401);
// User-facing revoke page works without sharing secrets with ChatGPT.
const fresh=await authorize(),freshTokens=(await req('/oauth/token',{method:'POST',form:{...codeForm,code:fresh.code}})).data;access=freshTokens.access_token;
const revokePage=await req('/oauth/connections'),revokeInfo=formInfo(revokePage);eq((await req('/oauth/connections',{method:'POST',headers:{Cookie:revokeInfo.cookie},form:{context:revokeInfo.context,role_id:a.id,role_key:a.access_token}})).status,200);eq((await call('memory_profile')).status,401);
eq((await req('/api/roles/'+a.id,{headers:{Authorization:'Bearer '+a.access_token}})).status,200);
// Rotating an existing role key invalidates OAuth grants, not other roles.
const finalFlow=await authorize(),finalTokens=(await req('/oauth/token',{method:'POST',form:{...codeForm,code:finalFlow.code}})).data;access=finalTokens.access_token;await req('/api/roles/'+a.id+'/rotate-token',{method:'POST',headers:admin,json:{}});eq((await call('memory_profile')).status,401);eq((await req('/oauth/token',{method:'POST',form:{grant_type:'refresh_token',client_id:client,resource,refresh_token:finalTokens.refresh_token}})).status,400);eq((await req('/api/roles/'+b.id,{headers:{Authorization:'Bearer '+b.access_token}})).status,200);
// Cancellation returns OAuth error/state/issuer, never a credential.
const cancel=await page(),cancelled=await req('/oauth/authorize',{method:'POST',headers:{Cookie:cancel.cookie},form:{context:cancel.context,decision:'deny'}});eq(new URL(cancelled.r.headers.get('location')).searchParams.get('error'),'access_denied');
// Abuse throttling and oversized bodies fail closed.
let limited;for(let i=0;i<11;i++)limited=await req('/oauth/authorize',{method:'POST',headers:{Cookie:first.cookie,'CF-Connecting-IP':'192.0.2.100'},form:{context:first.context,role_id:'nonexistent',role_key:'bad',decision:'allow'}});eq(limited.status,429);
eq((await req('/oauth/token',{method:'POST',form:{a:'x'.repeat(17000)}})).status,413);
console.log('PASS '+n+' OAuth checks: D1/SQLite, discovery, DCR, PKCE, CSRF, one-use grants, concurrent redemption, role/scope isolation, refresh rotation/reuse, expiry, revocation, legacy auth, and throttling.');
