// 极简管理面板后端（v0.5.0）：读状态 + 切开关。不引框架、不做用户体系。
// 鉴权：ADMIN_TOKEN（.env 配置）；未配置则接口全部 503（面板不可用，零暴露）。
// 与页面同源部署：GET /admin 返回单文件 HTML，接口在 /api/admin/*。
import { Router, type Request, type Response, type NextFunction } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { db, getFlag, setFlag } from '../db';
import { makeIpRateLimit } from '../auth';
import { z } from 'zod';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

// 定值时间比较（先各自 sha256 归一长度，避免通过长度/早退泄露 token）
function tokenMatches(provided: string): boolean {
  if (!ADMIN_TOKEN) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(ADMIN_TOKEN).digest();
  return timingSafeEqual(a, b);
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!ADMIN_TOKEN) {
    res.status(503).json({ error: '管理面板未启用：请在 .env 配置 ADMIN_TOKEN 后重启容器' });
    return;
  }
  const header = req.headers.authorization || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!provided || !tokenMatches(provided)) {
    res.status(401).json({ error: '管理口令错误' });
    return;
  }
  next();
}

// 管理接口失败限流：每分钟 10 次（防口令爆破）
const adminRateLimit = makeIpRateLimit(10, 60_000);

function readState() {
  const users = (db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c;
  const families = (db.prepare("SELECT COUNT(*) c FROM families WHERE type = 'family'").get() as { c: number }).c;
  const records = (db.prepare('SELECT COUNT(*) c FROM records WHERE deleted = 0').get() as { c: number }).c;
  const last = db.prepare('SELECT MAX(updated_at) t FROM records').get() as { t: number | null };
  return {
    allowRegister: getFlag('allow_register') === '1',
    allowJoin: getFlag('allow_join') === '1',
    stats: { users, families, records, lastSyncAt: last.t ?? 0 },
  };
}

const flagsSchema = z.object({
  allowRegister: z.boolean().optional(),
  allowJoin: z.boolean().optional(),
});

export const adminPageRouter = Router();
export const adminApiRouter = Router();

// 单文件面板页（内联，避免 Docker tsc 构建不拷贝静态资源导致 404；接口走同源 fetch）
// 注意：本 router 挂载在 app.use('/admin', ...)，故此处路径为 '/'
adminPageRouter.get('/', (_req, res) => {
  res.type('html').send(ADMIN_HTML);
});

adminApiRouter.get('/state', adminRateLimit, requireAdmin, (_req, res) => {
  res.json(readState());
});

adminApiRouter.post('/flags', adminRateLimit, requireAdmin, (req, res) => {
  const parsed = flagsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: '参数无效' });
    return;
  }
  if (typeof parsed.data.allowRegister === 'boolean') setFlag('allow_register', parsed.data.allowRegister ? '1' : '0');
  if (typeof parsed.data.allowJoin === 'boolean') setFlag('allow_join', parsed.data.allowJoin ? '1' : '0');
  res.json(readState());
});

// 自包含单页面板（内联 JS 用字符串拼接，避免与 TS 模板字符串的 ${ } 冲突）
const ADMIN_HTML = [
'<!doctype html><html lang="zh"><head><meta charset="utf-8">',
'<meta name="viewport" content="width=device-width,initial-scale=1">',
'<title>一点账本 · 管理面板</title><style>',
'body{font-family:-apple-system,PingFang SC,Microsoft YaHei,sans-serif;background:#F8F6F3;color:#2D2D2D;margin:0;padding:24px;max-width:520px;margin:0 auto}',
'h1{font-size:20px;margin:0 0 4px}.sub{color:#857F78;font-size:13px;margin-bottom:20px}',
'.card{background:#fff;border:1px solid #F0EDE8;border-radius:16px;padding:16px;margin-bottom:16px}',
'input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #E8E4DE;border-radius:10px;font-size:14px}',
'button{margin-top:10px;width:100%;padding:10px;border:0;border-radius:10px;background:#7986CB;color:#fff;font-size:14px;font-weight:700;cursor:pointer}',
'.row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #F5F2EE}',
'.row:last-child{border-bottom:0}.name{font-size:15px;font-weight:600}.desc{font-size:12px;color:#857F78;margin-top:2px}',
'.stats{font-size:13px;color:#6E6E6E;line-height:1.9}.err{color:#E57373;font-size:13px;margin-top:10px;min-height:18px}',
'.ok{color:#2E7D32}',
'</style></head><body>',
'<h1>一点账本 管理面板</h1><div class="sub">开关即时生效，无需重启容器</div>',
'<div class="card"><div style="font-size:13px;margin-bottom:6px">管理口令 ADMIN_TOKEN</div>',
'<input id="tok" type="password" placeholder="粘贴 .env 中配置的 ADMIN_TOKEN"><button onclick="load()">连接并加载</button>',
'<div id="err" class="err"></div></div>',
'<div class="card" id="panel" style="display:none">',
'<div class="row"><div><div class="name">允许新用户注册</div><div class="desc">关闭后仅老用户可登录，阻断新账号进入</div></div>',
'<input type="checkbox" id="reg" style="width:auto" onchange="save()"></div>',
'<div class="row"><div><div class="name">允许邀请码加入家庭</div><div class="desc">关闭后即便拿到邀请码也无法加入</div></div>',
'<input type="checkbox" id="join" style="width:auto" onchange="save()"></div>',
'<div class="stats" id="stats"></div></div>',
'<script>',
'function token(){return document.getElementById("tok").value.trim()}',
'function show(m,good){var e=document.getElementById("err");e.textContent=m||"";e.className=good?"err ok":"err"}',
'function render(s){document.getElementById("reg").checked=s.allowRegister;document.getElementById("join").checked=s.allowJoin;',
'var d=new Date(s.stats.lastSyncAt);var t=s.stats.lastSyncAt?d.getFullYear()+"-"+(d.getMonth()+1)+"-"+d.getDate()+" "+("0"+d.getHours()).slice(-2)+":"+("0"+d.getMinutes()).slice(-2):"暂无";',
'document.getElementById("stats").innerHTML="用户 "+s.stats.users+" ｜ 家庭 "+s.stats.families+" ｜ 有效记录 "+s.stats.records+" ｜ 最近同步 "+t;',
'document.getElementById("panel").style.display="block"}',
'function api(path,body){return fetch(path,{method:body?"POST":"GET",headers:{"content-type":"application/json","authorization":"Bearer "+token()},body:body?JSON.stringify(body):null}).then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})}',
'function load(){if(!token()){show("请先输入管理口令");return}api("/api/admin/state").then(function(r){if(r.s!==200){show(r.j&&r.j.error?("加载失败："+r.j.error):("加载失败 "+r.s));document.getElementById("panel").style.display="none";return}localStorage.setItem("tl_admin_tok",token());show("已连接",true);render(r.j)}).catch(function(){show("网络错误")})}',
'function save(){api("/api/admin/flags",{allowRegister:document.getElementById("reg").checked,allowJoin:document.getElementById("join").checked}).then(function(r){if(r.s!==200){show("保存失败："+(r.j&&r.j.error||r.s));return}render(r.j);show("已保存并生效",true)}).catch(function(){show("网络错误")})}',
'(function(){var t=localStorage.getItem("tl_admin_tok");if(t){document.getElementById("tok").value=t;load()}})()',
'</script></body></html>',
].join('\n');
