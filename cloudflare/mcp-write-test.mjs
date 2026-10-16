import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
const env={ADMIN_TOKEN:'test-admin-long-enough-123456789',MEMORY_DB:{prepare(sql){const statement=db.prepare(sql);let values=[];const p={bind(...v){values=v;return p},async first(){return statement.get(...values)||null},async all(){return {results:statement.all(...values)}},async run(){return statement.run(...values)}};return p}}};
let id=0;async function api(path,data,key=env.ADMIN_TOKEN){const r=await worker.fetch(new Request('https://memory.example'+path,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})}),env);return {status:r.status,j:await r.json()}}
const a=(await api('/api/roles',{name:'岑'})).j,b=(await api('/api/roles',{name:'另一个角色'})).j;
async function rpc(name,args,{key=a.access_token,role=a.id}={}){return api('/mcp/'+role,{jsonrpc:'2.0',id:++id,method:name==='tools/list'?'tools/list':'tools/call',...(name==='tools/list'?{}:{params:{name,arguments:args}})},key)}
const listed=(await rpc('tools/list')).j.result.tools;assert.equal(listed.length,2);assert.deepEqual(listed.find(t=>t.name==='memory_save').inputSchema.required,['content']);
let r=await rpc('memory_save',{title:'偏好',content:'用户喜欢蓝粉色。'});assert.equal(r.j.result.isError,undefined);assert(JSON.parse(r.j.result.content[0].text).ok);
r=await rpc('memory_save',{content:'希望助手按需发送语音。'});assert(JSON.parse(r.j.result.content[0].text).title.startsWith('希望助手'));
r=await rpc('memory_save',{name:'关系约定',text:'不要凭空猜测用户的现实状态。',role_id:b.id});assert(JSON.parse(r.j.result.content[0].text).ok);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memories WHERE role_id=?').get(b.id).n,0);
for(const args of [JSON.stringify({content:'普通字符串参数'}),JSON.stringify(JSON.stringify({content:'双层编码参数'}))]){r=await rpc('memory_save',args);assert(JSON.parse(r.j.result.content[0].text).ok)}
const before=db.prepare('SELECT COUNT(*) AS n FROM memories').get().n;
for(const [args,expected]of [[{title:'只有文件名.md'},/缺少非空正文/],[{content:{fact:'对象不能冒充正文'}},/缺少非空正文/],[{content:'   '},/缺少非空正文/],[{content:'字'.repeat(12001)},/12001.*12000/],[{content:'不应保存',kind:'other'},/kind/],['{broken',/完整 JSON/],[[],/JSON 对象/]]){r=await rpc('memory_save',args);assert.equal(r.j.result.isError,true);assert.match(JSON.parse(r.j.result.content[0].text).error,expected)}
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memories').get().n,before);
r=await rpc('memory_save',{content:'用户喜欢蓝粉色。'});assert(JSON.parse(r.j.result.content[0].text).already_exists);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memories').get().n,before);
r=await rpc('memory_save',{content:'冒充其他角色'},{role:b.id});assert.equal(r.status,403);
r=await rpc('memory_save',{content:'另一角色的记忆'},{key:b.access_token,role:b.id});assert(JSON.parse(r.j.result.content[0].text).ok);r=await rpc('memory_search',{query:'另一角色'});assert.equal(JSON.parse(r.j.result.content[0].text).entries.length,0);
assert.equal((await api('/health')).j.version,'1.0.1');
console.log('PASS MCP writes: real SQLite through bundled Worker; content-only and alias writes, object/encoded arguments, canonical schema, specific validation, no phantom writes, deduplication and role authorization. No external requests.');
