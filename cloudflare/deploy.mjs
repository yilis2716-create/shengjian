import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const API='https://api.cloudflare.com/client/v4';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function deploy({token,accountId='',workerName='shengjian-memory',workerUrl,source,proactive=false,fetchImpl=fetch,delay=sleep,log=console.log}){
  if(!token?.trim())throw Error('请先在 GitHub Actions Secrets 中设置 CLOUDFLARE_API_TOKEN。');
  if(!/^[a-z0-9][a-z0-9-]{0,62}$/.test(workerName))throw Error('Worker 名称不正确。');
  const publicUrl=new URL(workerUrl);
  if(publicUrl.protocol!=='https:'||publicUrl.username||publicUrl.password||!publicUrl.hostname.endsWith('.workers.dev')||!publicUrl.hostname.startsWith(workerName+'.')||publicUrl.pathname!=='/')throw Error('部署验证地址必须是此 Worker 的 HTTPS workers.dev 根地址。');
  if(typeof source!=='string'||!source.includes('runProactiveScheduled')||!source.includes('ADMIN_HTML'))throw Error('Worker 文件缺失或不是完整声笺后台，未上传。');
  const privateValues=new Set([token]);
  const redact=message=>{let text=String(message);for(const secret of privateValues)if(secret)text=text.split(secret).join('[redacted]');return text.slice(0,500)};
  async function api(path,options={}){
    let response;
    try{response=await fetchImpl(API+path,{...options,headers:{...options.headers,Authorization:'Bearer '+token},signal:AbortSignal.timeout(60000)})}catch{throw Error('Cloudflare API 网络请求失败。请查看运行状态后重试；令牌未输出。')}
    let body;try{body=await response.json()}catch{throw Error('Cloudflare API 返回非 JSON 响应（HTTP '+response.status+'）。')}
    if(!response.ok||body.success!==true)throw Error('Cloudflare API 请求失败（HTTP '+response.status+'）：'+redact((body.errors||[]).map(e=>String(e.code||'')+' '+String(e.message||'')).join('; ')||'请检查授权及服务状态'));
    return body;
  }
  if(!accountId){
    const listed=await api('/accounts?per_page=50');
    if(!Array.isArray(listed.result)||listed.result.length!==1||Number(listed.result_info?.total_count||listed.result.length)!==1)throw Error('令牌可访问零个或多个账户。请将授权限制到已创建 Worker 的账户，或设置仓库变量 CLOUDFLARE_ACCOUNT_ID。');
    accountId=listed.result[0].id;
  }
  if(!/^[a-f0-9]{32}$/i.test(accountId))throw Error('Cloudflare Account ID 格式不正确。');
  const path='/accounts/'+accountId+'/workers/scripts/'+workerName;
  const {result:settings}=await api(path+'/settings');
  if(!Array.isArray(settings?.bindings))throw Error('无法读取现有 Worker 绑定，已停止，不会新建或清空数据库。');
  const bindings=settings.bindings;
  const db=bindings.find(b=>b.name==='MEMORY_DB'&&b.type==='d1');
  if(!db?.id)throw Error('现有 Worker 缺少 MEMORY_DB D1 绑定，未部署。');
  if(!bindings.some(b=>b.name==='ADMIN_TOKEN'&&b.type==='secret_text'))throw Error('现有 Worker 缺少 ADMIN_TOKEN Secret，未部署。');
  if(!bindings.some(b=>b.name==='ALLOWED_ORIGINS'&&b.type==='plain_text'&&b.text?.trim()))throw Error('现有 Worker 缺少 ALLOWED_ORIGINS 文本变量，未部署。');
  const supported=new Set(['d1','secret_text','plain_text','json']);
  if(bindings.some(b=>!supported.has(b.type)))throw Error('检测到额外类型的绑定，为避免更改现有资源，请先检查部署脚本。');
  const added=proactive?await proactiveBindings(bindings,publicUrl.origin):[];
  for(const b of added)if(b.type==='secret_text')privateValues.add(b.text);
  const metadata={main_module:'worker.mjs',compatibility_date:settings.compatibility_date||'2026-10-12',bindings:[...bindings.filter(b=>b.type!=='secret_text'),...added],keep_bindings:['secret_text']};
  for(const key of ['compatibility_flags','observability','logpush','placement','tail_consumers','limits'])if(settings[key]!==undefined)metadata[key]=settings[key];
  const form=new FormData();form.append('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));form.append('worker.mjs',new Blob([source],{type:'application/javascript+module'}),'worker.mjs');
  log('已确认现有数据库绑定和 Secret；正在上传后台代码，保留全部既有密钥。'+(proactive?' 缺失的主动通知密钥仅在部署进程生成并直接写入 Cloudflare，不输出内容。':''));
  await api(path,{method:'PUT',body:form});
  log('Cloudflare 已接受部署，正在验证后台可访问。');
  let healthy=false;
  for(let attempt=0;attempt<6;attempt++){
    if(attempt)await delay(2500);
    try{const response=await fetchImpl(new URL('/health',publicUrl),{signal:AbortSignal.timeout(15000),redirect:'error'});if(response.ok){const data=await response.json();if(data.ok===true&&data.service==='shared-memory'&&data.configured===true){healthy=true;break}}}catch{}
  }
  if(!healthy)throw Error('代码已经上传，但 /health 尚未验证成功；请检查 workers.dev 可访问性和部署日志，不要重建数据库。');
  if(proactive){
    try{
      const {result:schedules}=await api(path+'/schedules');
      if(!Array.isArray(schedules))throw Error('无法读取现有定时器');
      const crons=[...new Set(schedules.map(s=>s.cron))];
      if(!crons.includes('*/5 * * * *')){if(crons.length>=3)throw Error('已有三个定时器，未替换现有任务');await api(path+'/schedules',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify([...crons,'*/5 * * * *'].map(cron=>({cron})))})}
      const checked=await api(path+'/schedules');
      if(!checked.result?.some(s=>s.cron==='*/5 * * * *'))throw Error('定时器保存后未能确认');
      log('已确认每5分钟云端定时器；Cloudflare 的定时配置传播可能需要数分钟。角色启用仍需手机确认。');
    }catch(e){throw Error('后台和密钥已上传，但定时器未完成：'+redact(e.message)+'。请检查 Workers Scripts Edit 权限或现有定时器数量，不要重建数据库。')}
  }
  log('部署完成：'+publicUrl.origin+'。健康检查通过。');
  return {url:publicUrl.origin,healthy:true};
}
export async function proactiveBindings(bindings,origin){
  const has=name=>bindings.some(b=>b.name===name),added=[];
  const publicPresent=has('VAPID_PUBLIC_KEY'),privatePresent=has('VAPID_PRIVATE_JWK');
  if(publicPresent!==privatePresent)throw Error('现有 VAPID 公私钥仅有一半。为保护既有订阅，未自动更换；请补齐原密钥或明确安排重新订阅。');
  if(!has('CONFIG_ENCRYPTION_KEY'))added.push({type:'secret_text',name:'CONFIG_ENCRYPTION_KEY',text:Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')});
  if(!publicPresent){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);added.push({type:'secret_text',name:'VAPID_PRIVATE_JWK',text:JSON.stringify(await crypto.subtle.exportKey('jwk',pair.privateKey))},{type:'plain_text',name:'VAPID_PUBLIC_KEY',text:Buffer.from(await crypto.subtle.exportKey('raw',pair.publicKey)).toString('base64url')})}
  if(!has('VAPID_SUBJECT'))added.push({type:'plain_text',name:'VAPID_SUBJECT',text:origin+'/'});
  return added;
}
async function main(){
  const config=JSON.parse(await readFile(new URL('./deploy-request.json',import.meta.url),'utf8'));
  if(config.enabled!==true){console.log('等待授权后启用部署：本次未访问 Cloudflare。');return}
  const source=await readFile(new URL('./worker.mjs',import.meta.url),'utf8');
  await deploy({token:process.env.CLOUDFLARE_API_TOKEN,accountId:process.env.CLOUDFLARE_ACCOUNT_ID||'',workerName:config.workerName,workerUrl:config.workerUrl,proactive:config.proactive===true,source});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1});
