'use strict';

const { execSync } = require('child_process');
const path = require('path');

const cache = new Map();
const CACHE_TTL = 30000;

function wslExec(cmd) {
  return execSync(`wsl.exe -e bash -c ${JSON.stringify(cmd)}`, {
    encoding: 'utf-8', timeout: 8000,
  }).trim();
}

function getGitStatus(wslDir) {
  const cacheKey = wslDir;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    const branch = wslExec(`cd ${JSON.stringify(wslDir)} && git rev-parse --abbrev-ref HEAD 2>/dev/null`);
    const status = wslExec(`cd ${JSON.stringify(wslDir)} && git status --porcelain 2>/dev/null`);
    const ahead  = wslExec(`cd ${JSON.stringify(wslDir)} && git rev-list @{u}..HEAD --count 2>/dev/null || echo 0`);
    const behind = wslExec(`cd ${JSON.stringify(wslDir)} && git rev-list HEAD..@{u} --count 2>/dev/null || echo 0`);

    const lines = status ? status.split('\n').filter(Boolean) : [];
    const modified  = lines.filter(l => l[1] === 'M' || l[0] === 'M').length;
    const untracked = lines.filter(l => l.startsWith('??')).length;
    const staged    = lines.filter(l => l[0] !== ' ' && l[0] !== '?' && l[0] !== '!').length;

    const data = { branch, modified, untracked, staged, ahead: parseInt(ahead)||0, behind: parseInt(behind)||0, ok: true };
    cache.set(cacheKey, { ts: Date.now(), data });
    return data;
  } catch {
    return { ok: false };
  }
}

module.exports = {
  registerRoutes(router) {
    router.get('/api/plugin/git-status', async (req, res, url) => {
      const dir = url.searchParams.get('dir') || '';
      if (!dir) { res.writeHead(400); res.end(JSON.stringify({ error: 'no dir' })); return; }
      const data = getGitStatus(dir);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    });
  },

  getUICode() {
    return {
      html: `<div id="gs-root" style="font-size:9px;color:var(--muted)">패널을 선택하면 Git 상태가 표시됩니다</div>`,
      js: `
(function(el){
  let cur='';
  async function refresh(dir){
    if(!dir)return;
    const r=await fetch('/api/plugin/git-status?dir='+encodeURIComponent(dir));
    const d=await r.json();
    if(!d.ok){el.innerHTML='<span style="color:var(--muted)">git 레포 없음</span>';return}
    const bc=d.branch==='main'||d.branch==='master'?'var(--green)':'var(--amber)';
    const rows=[];
    rows.push('<span style="color:'+bc+'">⎇ '+d.branch+'</span>');
    if(d.staged)rows.push('<span style="color:var(--cyan)">▲ '+d.staged+' staged</span>');
    if(d.modified)rows.push('<span style="color:var(--amber)">M '+d.modified+' modified</span>');
    if(d.untracked)rows.push('<span style="color:var(--dim)">? '+d.untracked+' untracked</span>');
    if(d.ahead)rows.push('<span style="color:var(--purple)">↑'+d.ahead+'</span>');
    if(d.behind)rows.push('<span style="color:var(--red)">↓'+d.behind+'</span>');
    if(!d.staged&&!d.modified&&!d.untracked)rows.push('<span style="color:var(--green)">✓ clean</span>');
    el.innerHTML=rows.join(' &nbsp; ');
  }
  setInterval(()=>{
    const p=window.state&&window.state.panels?window.state.panels.find(Boolean):null;
    const dir=p?p.fullPath:'';
    if(dir!==cur){cur=dir;refresh(dir);}
  },3000);
})(el);
`,
    };
  },
};
