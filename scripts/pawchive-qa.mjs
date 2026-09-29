// Manual browser fixture: node scripts/pawchive-qa.mjs (no network/download side effects).
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const base = "/fanbox/user/123";
const media = (n) => {
  const hash = "aabb" + String(n).padStart(60, "c");
  return `https://file.pawchive.pw/data/aa/bb/${hash}.jpg?f=illustration-${n}.jpg`;
};
const files = { 1: [0, 1], 2: [0, 2], 3: [3], 4: [] };
const page = (url) => {
  const postId = /\/post\/(\d+)/.exec(url.pathname)?.[1];
  if (postId) return `<section class="site-section--post" data-service="fanbox" data-user="123" data-id="${postId}">
    <header class="post__header"><a class="post__user-name" href="${base}">测试作者 · 一段较长的作者名称</a><h1>示例帖子 ${postId}</h1><div class="post__actions"></div></header>
    <div class="post__files">${(files[postId] ?? []).map((n) => `<a class="fileThumb" href="${media(n)}" download="illustration-${n}.jpg">原图 ${n}</a>`).join("")}</div></section>`;
  const ids = url.searchParams.get("o") === "50" ? [3, 4] : [1, 2];
  return `<header class="user-header" data-service="fanbox" data-id="123"><h1 class="user-header__name">测试作者 · 一段较长的作者名称</h1><div class="user-header__actions"></div></header>
    <div class="paginator"><small>Showing ${ids[0]} - ${ids[1]} of 4</small><a href="${base}?o=0&q=ignore">1</a><a href="${base}?o=50&q=ignore">2</a></div>
    <div class="cards">${ids.map((id) => `<article class="post-card" data-service="fanbox" data-user="123" data-id="${id}"><a href="${base}/post/${id}"><header class="post-card__header">示例帖子 ${id}</header><div class="post-card__image-container">${id === 4 ? "站点未归档" : "媒体占位"}</div><footer>附件与封面</footer></a></article>`).join("")}</div>`;
};
const css = `body{background:#151515;color:#fff;font:16px sans-serif;margin:0;padding:24px}main{max-width:1000px;margin:24px auto}a{color:inherit}.user-header{display:flex;align-items:center;justify-content:space-between;gap:20px}.user-header h1{font-size:24px}.paginator{display:flex;gap:20px;margin:24px 0}.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.post-card{background:#242424;border-radius:10px;padding:16px}.post-card>a{display:block;text-decoration:none}.post-card__image-container{height:180px;background:#282b34;margin:16px 0;display:grid;place-items:center;color:#bfbfbf}#qa{padding:12px;border:1px dashed #777;font-size:13px}#qa button,#qa select{min-height:40px;margin:4px}#qa-status{display:block}@media(max-width:480px){body{padding:12px}.cards{grid-template-columns:1fr}.user-header{align-items:start;flex-wrap:wrap}}`;
const client = `
await import('/utils/pawchive-core.js');
const { createPawchiveService } = await import('/utils/pawchive-downloads.js');
const saved = JSON.parse(localStorage.getItem('pawchive-qa') || '{}');
const data = saved.data || {}, history = saved.history || [], listeners = [];
let calls = saved.calls || 0, fetches = 0, maximum = 0;
const status = document.getElementById('qa-status');
const persist = () => {
 localStorage.setItem('pawchive-qa', JSON.stringify({data,history,calls}));
 status.textContent = '模拟下载调用：' + calls + ' · 完成：' + history.filter(x=>x.state==='complete').length + ' · 同时获取峰值：' + maximum;
};
const api = {
 storage:{local:{get:async key=>structuredClone({[key]:data[key]}),set:async values=>{Object.assign(data,structuredClone(values));persist();for(const fn of listeners)fn(Object.fromEntries(Object.keys(values).map(k=>[k,{newValue:values[k]}])),'local');}},onChanged:{addListener:fn=>listeners.push(fn)}},
 downloads:{search:async query=>structuredClone(history.filter(x=>query.id==null||query.id===x.id)),download:async options=>{
 calls++; const id=history.length+1; history.push({id,url:options.url,filename:'C:/Downloads/'+options.filename,state:'in_progress',startTime:new Date().toISOString()});persist();return id;
 },cancel:async id=>{const item=history.find(x=>x.id===id);if(item)item.state='interrupted';persist();}},
 alarms:{create:async()=>{},clear:async()=>{}}
};
const service=createPawchiveService(api);
const actions={status:scope=>service.snapshot(scope),inspect:(scope,posts)=>service.inspect(posts),preview:(scope,posts)=>service.preview(posts),submit:(scope,posts)=>service.submit(posts),retry:scope=>service.retry(scope),stop:scope=>service.stop(scope)};
const canonical=globalThis.UtilsPawchive.parsePageUrl;
globalThis.UtilsPawchive.parsePageUrl=value=>canonical(String(value).replace(location.origin,'https://pawchive.pw'));
globalThis.chrome={storage:api.storage,runtime:{sendMessage:async message=>{
 try{return {ok:true,...await actions[message.type.split('.').at(-1)](message,message.posts)}}
 catch(error){return {ok:false,error:error.message}}
}}};
const nativeFetch=globalThis.fetch;
globalThis.fetch=async (value,options)=>{
 const mode=document.getElementById('qa-mode').value;
 const url=String(value).replace('https://pawchive.pw',location.origin);
 if(mode==='page-error'&&url.includes('?o=50'))throw new Error('mock pagination error');
 if(mode==='post-error'&&url.includes('/post/3'))throw new Error('mock post error');
 maximum=Math.max(maximum,++fetches);persist();
 try{await new Promise(resolve=>setTimeout(resolve,300));return await nativeFetch(url,options);}finally{fetches--;persist();}
};
document.getElementById('qa-reset').onclick=()=>{localStorage.removeItem('pawchive-qa');location.reload();};
document.getElementById('qa-complete').onclick=async()=>{for(const item of [...history].filter(x=>x.state==='in_progress')){item.state='complete';await service.changed({id:item.id,state:{current:'complete'}});}persist();};
document.getElementById('qa-fail').onclick=async()=>{const item=history.find(x=>x.state==='in_progress');if(item){item.state='interrupted';await service.changed({id:item.id,state:{current:'interrupted'}});}persist();};
persist();
await import('/utils/pawchive-media.js');
`;
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:43127");
  try {
    if (url.pathname === "/qa-client.js") { response.setHeader("Content-Type", "text/javascript"); response.end(client); return; }
    if (/^\/utils\/pawchive-(core|downloads|media)\.(js|css)$/.test(url.pathname)) {
      response.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : "text/javascript");
      response.end(await readFile(root + url.pathname.slice(1))); return;
    }
    if (url.pathname.startsWith(base)) {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(`<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pawchive QA</title><link rel="stylesheet" href="/utils/pawchive-media.css"><style>${css}</style><body><aside id="qa"><strong>模拟验证 · 不会下载文件</strong><span id="qa-status"></span><label>故障 <select id="qa-mode"><option value="normal">正常</option><option value="page-error">分页失败</option><option value="post-error">帖子失败</option></select></label><button id="qa-complete">完成当前下载</button><button id="qa-fail">让一项失败</button><button id="qa-reset">重置模拟记录</button><a href="${base}?o=50&q=filtered">从第 2 页进入</a></aside><main>${page(url)}</main><script type="module" src="/qa-client.js"></script></body></html>`); return;
    }
    response.writeHead(404); response.end();
  } catch (error) { response.writeHead(500); response.end(String(error)); }
});
server.listen(43127, "127.0.0.1", () => console.log(`Pawchive QA: http://127.0.0.1:43127${base}?o=50&q=filtered`));
