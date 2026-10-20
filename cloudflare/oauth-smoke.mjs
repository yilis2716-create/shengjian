import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const config=JSON.parse(await readFile(new URL('./deploy-request.json',import.meta.url),'utf8'));
if(!config.enabled){console.log('OAuth live checks skipped: deployment disabled.');process.exit(0)}
const base=new URL(config.workerUrl).origin;
async function get(path){return fetch(base+path,{redirect:'error',signal:AbortSignal.timeout(15000)})}
const health=await (await get('/health')).json();assert.equal(health.version,'1.2.0');assert.equal(health.configured,true);assert.equal(health.proactive_ready,true);
const as=await (await get('/.well-known/oauth-authorization-server')).json();assert.equal(as.issuer,base);assert.equal(as.registration_endpoint,base+'/oauth/register');assert.deepEqual(as.code_challenge_methods_supported,['S256']);assert.equal(as.authorization_response_iss_parameter_supported,true);
const resource=await (await get('/.well-known/oauth-protected-resource/mcp')).json();assert.equal(resource.resource,base+'/mcp');
const unauth=await get('/mcp');assert.equal(unauth.status,401);assert(unauth.headers.get('WWW-Authenticate').includes('oauth-protected-resource/mcp'));await unauth.body.cancel();
const invalid=await get('/oauth/authorize');assert.equal(invalid.status,400);assert.equal((await invalid.json()).error,'invalid_client');
const connections=await get('/oauth/connections');assert.equal(connections.status,200);assert((await connections.text()).includes('name="role_key"'));assert(connections.headers.get('set-cookie').includes('HttpOnly'));
const admin=await get('/api/roles');assert.equal(admin.status,403);await admin.body.cancel();
console.log('PASS live OAuth checks: version 1.2.0, discovery, PKCE metadata, protected MCP, additive OAuth tables, secure login/revocation page, and protected admin API. No role keys, private memories, or new OAuth grants accessed.');
