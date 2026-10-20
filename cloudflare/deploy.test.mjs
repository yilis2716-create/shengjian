import test from 'node:test';
import assert from 'node:assert/strict';
import {deploy,proactiveBindings} from './deploy.mjs';
const token='test-deploy-secret-never-log',account='a'.repeat(32),workerUrl='https://shengjian-memory.yilis2716.workers.dev',source='const ADMIN_HTML="html"; function runProactiveScheduled() {}';
const bindings=[{name:'MEMORY_DB',type:'d1',id:'existing-database'},{name:'ADMIN_TOKEN',type:'secret_text'},{name:'CONFIG_ENCRYPTION_KEY',type:'secret_text'},{name:'ALLOWED_ORIGINS',type:'plain_text',text:'https://yilis2716-create.github.io'},{name:'VAPID_PUBLIC_KEY',type:'plain_text',text:'existing-public-key'}];
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}}),ok=result=>json({success:true,result});
function mock({accounts=[{id:account}],bound=bindings,uploadError=false,healthy=true}={}){const requests=[],logs=[];let uploaded;return {requests,logs,get uploaded(){return uploaded},async fetch(url,options={}){url=String(url);requests.push({url,method:options.method||'GET'});if(url.startsWith('https://api.cloudflare.com/'))assert.equal(options.headers.Authorization,'Bearer '+token);else assert(!options.headers?.Authorization,'no deploy token on public health endpoint');if(url.endsWith('/accounts?per_page=50'))return ok(accounts);if(url.endsWith('/settings'))return ok({bindings:bound,compatibility_date:'2026-10-12',compatibility_flags:['flag'],observability:{enabled:true}});if(options.method==='PUT'){uploaded=JSON.parse(await options.body.get('metadata').text());assert.equal(await options.body.get('worker.mjs').text(),source);if(uploadError)return new Response(JSON.stringify({success:false,errors:[{message:'server echoed '+token}]}),{status:403});return ok({id:'version'})}if(url.endsWith('/health'))return healthy?json({ok:true,service:'shared-memory',configured:true}):new Response('Hello World!');throw Error('unexpected endpoint '+url)}}}
const run=async(m,extra={})=>deploy({token,workerUrl,source,fetchImpl:m.fetch.bind(m),delay:async()=>{},log:message=>m.logs.push(message),...extra});
test('upload preserves D1, plaintext, all secret types and existing settings; validates without exposing token',async()=>{const m=mock();assert((await run(m)).healthy);assert.deepEqual(m.uploaded.keep_bindings,['secret_text']);assert.deepEqual(m.uploaded.bindings,bindings.filter(b=>b.type!=='secret_text'));assert(!JSON.stringify(m.uploaded).includes('ADMIN_TOKEN'));assert.deepEqual(m.uploaded.observability,{enabled:true});assert(!m.logs.join().includes(token));assert.equal(m.requests.filter(r=>r.method==='PUT').length,1);assert(!m.requests.some(r=>/d1\/|schedules|tokens|secrets/.test(r.url)))});
test('no upload when token, D1 binding or admin Secret is missing',async()=>{await assert.rejects(run(mock(),{token:''}),/Secrets/);for(const key of ['MEMORY_DB','ADMIN_TOKEN','ALLOWED_ORIGINS']){const m=mock({bound:bindings.filter(b=>b.name!==key)});await assert.rejects(run(m));assert(!m.requests.some(r=>r.method==='PUT'))}});
test('ambiguous account and extra bindings stop without making changes',async()=>{for(const cfg of [{accounts:[]},{accounts:[{id:account},{id:'b'.repeat(32)}]},{bound:[...bindings,{type:'durable_object_namespace',name:'OTHER'}]}]){const m=mock(cfg);await assert.rejects(run(m));assert(!m.requests.some(r=>r.method==='PUT'))}});
test('explicit account skips listing; health checks bounded; no repeat uploads',async()=>{const m=mock({healthy:false});await assert.rejects(run(m,{accountId:account}),/已经上传/);assert(!m.requests.some(r=>r.url.includes('/accounts?')));assert.equal(m.requests.filter(r=>r.url.endsWith('/health')).length,6);assert.equal(m.requests.filter(r=>r.method==='PUT').length,1)});
test('redacts token in remote errors and prevents arbitrary verification URLs',async()=>{await assert.rejects(run(mock({uploadError:true})),error=>!error.message.includes(token)&&error.message.includes('[redacted]'));for(const url of ['https://evil.example/','https://other.yilis2716.workers.dev/','https://user:password@shengjian-memory.yilis2716.workers.dev/']){const m=mock();await assert.rejects(run(m,{workerUrl:url}));assert.equal(m.requests.length,0)}});

test('new proactive keys form a matching VAPID pair and AES key, while existing secrets are preserved',async()=>{
 const fresh=await proactiveBindings(bindings.filter(b=>!['CONFIG_ENCRYPTION_KEY','VAPID_PUBLIC_KEY'].includes(b.name)),workerUrl);
 assert.equal(Buffer.from(fresh.find(b=>b.name==='CONFIG_ENCRYPTION_KEY').text,'base64url').length,32);
 const privateJwk=JSON.parse(fresh.find(b=>b.name==='VAPID_PRIVATE_JWK').text);
 const publicKey=Buffer.from(fresh.find(b=>b.name==='VAPID_PUBLIC_KEY').text,'base64url');
 assert.equal(publicKey.length,65);assert.equal(publicKey[0],4);assert(publicKey.subarray(1,33).equals(Buffer.from(privateJwk.x,'base64url')));assert(publicKey.subarray(33).equals(Buffer.from(privateJwk.y,'base64url')));
 const complete=[...bindings,{type:'secret_text',name:'VAPID_PRIVATE_JWK'},{type:'plain_text',name:'VAPID_SUBJECT',text:workerUrl+'/'}];
 assert.deepEqual(await proactiveBindings(complete,workerUrl),[]);
 await assert.rejects(proactiveBindings(bindings,workerUrl),/一半/);
});
test('proactive deployment provisions keys atomically, preserves other cron entries, and verifies timer readback',async()=>{
 const m=mock({bound:bindings.filter(b=>!['CONFIG_ENCRYPTION_KEY','VAPID_PUBLIC_KEY'].includes(b.name))});let crons=['0 12 * * *'],puts=0;
 const base=m.fetch.bind(m);m.fetch=async(url,opts={})=>{if(String(url).endsWith('/schedules')){assert.equal(opts.headers.Authorization,'Bearer '+token);if(opts.method==='PUT'){puts++;crons=JSON.parse(opts.body).map(s=>s.cron)}return ok({schedules:crons.map(cron=>({cron}))})}return base(url,opts)};
 await run(m,{proactive:true});assert.equal(puts,1);assert.deepEqual(crons,['0 12 * * *','*/5 * * * *']);
 assert.equal(m.uploaded.bindings.filter(b=>b.name==='CONFIG_ENCRYPTION_KEY').length,1);assert.equal(m.uploaded.bindings.filter(b=>b.name==='VAPID_PRIVATE_JWK').length,1);
 for(const b of m.uploaded.bindings.filter(b=>b.type==='secret_text'))assert(!m.logs.join().includes(b.text));
});
test('timer permission failures are reported after upload without exposing credentials',async()=>{
 const m=mock({bound:bindings.filter(b=>!['CONFIG_ENCRYPTION_KEY','VAPID_PUBLIC_KEY'].includes(b.name))}),base=m.fetch.bind(m);
 m.fetch=async(url,opts={})=>String(url).endsWith('/schedules')?new Response(JSON.stringify({success:false,errors:[{message:'insufficient permission'}]}),{status:403}):base(url,opts);
 await assert.rejects(run(m,{proactive:true}),e=>e.message.includes('后台和密钥已上传')&&e.message.includes('定时器')&&!e.message.includes(token));assert(m.uploaded);
});
