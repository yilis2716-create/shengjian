import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const API='https://api.cloudflare.com/client/v4';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function deploy({token,accountId='',workerName='shengjian-memory',workerUrl,source,fetchImpl=fetch,delay=sleep,log=console.log}){
  if(!token?.trim())throw Error('请先在 GitHub Actions Secrets 中设置 CLOUDFLARE_API_TOKEN。');
  if(!/^[a-z0-9][a-z0-9-]{0,62}$/.test(workerName))throw Error('Worker 名称不正确。');
  const publicUrl=new URL(workerUrl);
  if(publicUrl.protocol!=='https:'||publicUrl.username||publicUrl.password||!publicUrl.hostname.endsWith('.workers.dev')||!publicUrl.hostname.startsWith(workerName+'.')||publicUrl.pathname!=='/')throw Error('部署验证地址必须是此 Worker 的 HTTPS workers.dev 根地址。');
  if(typeof source!=='string'||!source.includes('runProactiveScheduled')||!source.includes('ADMIN_HTML'))throw Error('Worker 文件缺失或不是完整声笺后台，未上传。');
  const redact=message=>String(message).split(token).join('[redacted]').slice(0,500);
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
  const metadata={main_module:'worker.mjs',compatibility_date:settings.compatibility_date||'2026-10-12',bindings:bindings.filter(b=>b.type!=='secret_text'),keep_bindings:['secret_text']};
  for(const key of ['compatibility_flags','observability','logpush','placement','tail_consumers','limits'])if(settings[key]!==undefined)metadata[key]=settings[key];
  const form=new FormData();form.append('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));form.append('worker.mjs',new Blob([source],{type:'application/javascript+module'}),'worker.mjs');
  log('已确认现有数据库绑定和管理员 Secret；正在上传后台代码，不创建表或更改定时任务。');
  await api(path,{method:'PUT',body:form});
  log('Cloudflare 已接受部署，正在验证后台可访问。');
  let healthy=false;
  for(let attempt=0;attempt<6;attempt++){
    if(attempt)await delay(2500);
    try{const response=await fetchImpl(new URL('/health',publicUrl),{signal:AbortSignal.timeout(15000),redirect:'error'});if(response.ok){const data=await response.json();if(data.ok===true&&data.service==='shared-memory'&&data.configured===true){healthy=true;break}}}catch{}
  }
  if(!healthy)throw Error('代码已经上传，但 /health 尚未验证成功；请检查 workers.dev 可访问性和部署日志，不要重建数据库。');
  log('部署完成：'+publicUrl.origin+'。健康检查通过；数据库表和管理登录仍需后续确认。');
  return {url:publicUrl.origin,healthy:true};
}
async function main(){
  const config=JSON.parse(await readFile(new URL('./deploy-request.json',import.meta.url),'utf8'));
  if(config.enabled!==true){console.log('等待授权后启用部署：本次未访问 Cloudflare。');return}
  const source=await readFile(new URL('./worker.mjs',import.meta.url),'utf8');
  await deploy({token:process.env.CLOUDFLARE_API_TOKEN,accountId:process.env.CLOUDFLARE_ACCOUNT_ID||'',workerName:config.workerName,workerUrl:config.workerUrl,source});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1});
