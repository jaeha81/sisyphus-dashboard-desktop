'use strict';

const http    = require('http');
const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const zlib    = require('zlib');
const crypto  = require('crypto');
const { spawn, execFileSync, execSync } = require('child_process');
const httpProxy = require('http-proxy');
const wsl = require('./wsl');

const PANEL_PORTS = { 1: 17001, 2: 17002, 3: 17003, 4: 17004 };
const TERMINAL_RE = /^\/terminal\/([1-4])(\/.*)?$/;

let _WSL_HOME     = null;
let _OPENCODE_BIN = null;
let _TTYD_BIN     = null;

function getWSLHome() {
  if (!_WSL_HOME) _WSL_HOME = wsl.getWslHome();
  return _WSL_HOME;
}

function getTtydBin()     { return _TTYD_BIN     || `${getWSLHome()}/.local/bin/ttyd`; }
function getOpencodebin() {
  if (_OPENCODE_BIN) return _OPENCODE_BIN;
  const home = getWSLHome();
  const candidates = [
    `${home}/.local/bin/opencode`,
    `${home}/.nvm/versions/node/v24.14.0/bin/opencode`,
    `${home}/.nvm/versions/node/v22.0.0/bin/opencode`,
    '/usr/local/bin/opencode',
  ];
  for (const c of candidates) {
    try { wsl.wslExecSync(`test -x ${JSON.stringify(c)}`, { timeout: 3000 }); _OPENCODE_BIN = c; return c; } catch {}
  }
  _OPENCODE_BIN = 'opencode';
  return _OPENCODE_BIN;
}

function loadEnvFile(envFile) {
  try {
    const lines = fs.readFileSync(envFile, 'utf-8').split('\n');
    for (const line of lines) {
      const m = line.match(/^([A-Z_]+)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {}
}

function getGithubToken() { return process.env.GITHUB_TOKEN || ''; }

function getReposBase() {
  return (process.env.REPOS_BASE || '').split(',').map(s => s.trim()).filter(Boolean);
}

function getCloneBase(reposBase) {
  return process.env.CLONE_BASE || reposBase[0] || path.join(os.homedir(), 'repos');
}

function getNvmInit()      { return `source "${getWSLHome()}/.nvm/nvm.sh" 2>/dev/null`; }
function getWslEnvPrefix() {
  const h = getWSLHome();
  return `PATH="${h}/.nvm/versions/node/v24.14.0/bin:${h}/.local/bin:$PATH" TERM=xterm-256color`;
}

function openCodeDB() { return `${getWSLHome()}/.local/share/opencode/opencode.db`; }

function queryOcSessions(dir, limit = 20) {
  const db = openCodeDB();
  const script = `
import sqlite3, json, sys, os
db = ${JSON.stringify(db)}
if not os.path.exists(db):
    print("[]"); sys.exit(0)
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row
cur = conn.cursor()
cur.execute("""
  SELECT id, title, directory, time_created, time_updated,
         summary_files, summary_additions, summary_deletions,
         (SELECT COUNT(*) FROM message m WHERE m.session_id = s.id) as msg_count
  FROM session s
  WHERE (directory = ? OR directory LIKE ?)
    AND (time_archived IS NULL OR time_archived = 0)
  ORDER BY time_updated DESC
  LIMIT ?
""", (${JSON.stringify(dir)}, ${JSON.stringify(dir + '/%')}, ${limit}))
rows = [dict(r) for r in cur.fetchall()]
conn.close()
print(json.dumps(rows))
`.trim();

  try {
    const out = wsl.wslExecFileSync('python3', ['-c', script], { timeout: 6000 });
    return JSON.parse(out.trim());
  } catch { return []; }
}

function githubRequest(apiPath, token) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'api.github.com',
      path: apiPath,
      headers: {
        Authorization: `token ${token}`,
        'User-Agent': 'sisyphus-dashboard-desktop/1.0',
        Accept: 'application/vnd.github.v3+json',
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) reject(new Error(parsed.message || `HTTP ${res.statusCode}`));
          else resolve({ data: parsed, headers: res.headers });
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function fetchAllGithubRepos(token) {
  const { data: first, headers } = await githubRequest(
    '/user/repos?sort=full_name&direction=asc&per_page=100&affiliation=owner&page=1',
    token
  );
  if (!Array.isArray(first) || first.length === 0) return [];
  const all = [...first];
  if (first.length === 100 && headers.link) {
    const lastM = headers.link.match(/[?&]page=(\d+)>;\s*rel="last"/);
    if (lastM) {
      const total = parseInt(lastM[1]);
      const pages = await Promise.all(
        Array.from({ length: total - 1 }, (_, i) => i + 2).map(pg =>
          githubRequest(`/user/repos?sort=full_name&direction=asc&per_page=100&affiliation=owner&page=${pg}`, token)
            .then(r => r.data).catch(() => [])
        )
      );
      for (const pg of pages) if (Array.isArray(pg)) all.push(...pg);
    }
  }
  return all.map(r => ({
    id: r.id, name: r.name, fullName: r.full_name,
    description: r.description || '', language: r.language || '',
    private: r.private, stars: r.stargazers_count,
    cloneUrl: r.clone_url, sshUrl: r.ssh_url,
    pushedAt: r.pushed_at, defaultBranch: r.default_branch,
  }));
}

const cloneProgress  = {};
const ttydProcs      = {};
const panelState     = {};
let   ttydHtmlCache  = null;

const TTYD_AGENTS = Object.fromEntries(
  Object.entries(PANEL_PORTS).map(([n, port]) => [
    port,
    new http.Agent({ keepAlive: true, maxSockets: 4, keepAliveMsecs: 10000 }),
  ])
);

async function killPanel(n) {
  return new Promise((resolve) => {
    const p = ttydProcs[n];
    if (!p) return resolve();
    p.removeAllListeners('exit');
    p.on('exit', () => { delete ttydProcs[n]; resolve(); });
    try { p.kill('SIGKILL'); } catch { delete ttydProcs[n]; resolve(); }
  });
}

async function startPanel(n, port, repoDir, sessionId) {
  await killPanel(n);
  const HOME   = getWSLHome();
  const TTYD   = getTtydBin();
  const OC     = getOpencodebin();
  const NVM    = getNvmInit();
  const PREFIX = getWslEnvPrefix();
  let bashCmd;
  if (repoDir === null) {
    bashCmd = `${PREFIX} ${TTYD} --port ${port} --writable --ping-interval 15 --cwd "${HOME}" bash`;
    panelState[n] = { mode: 'idle' };
  } else {
    const cwd = repoDir || HOME;
    const ocCmd = sessionId
      ? `${NVM}; cd ${JSON.stringify(cwd)} && exec ${OC} --continue ${sessionId}`
      : `${NVM}; cd ${JSON.stringify(cwd)} && exec ${OC}`;
    bashCmd = `${PREFIX} ${TTYD} --port ${port} --writable --ping-interval 15 bash -c ${JSON.stringify(ocCmd)}`;
    panelState[n] = {
      mode: 'opencode',
      repo: repoDir ? path.basename(repoDir) : 'Home',
      dir: cwd,
      sessionId: sessionId || null,
    };
  }
  const proc = wsl.wslSpawn(bashCmd);
  proc.stderr.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg && !msg.includes('lws_')) console.log(`  [ttyd:${n}] ${msg}`);
  });
  proc.on('exit', (code) => {
    console.log(`  [ttyd:${n}] exited (${code})`);
    delete ttydProcs[n];
  });
  ttydProcs[n] = proc;
}

const CACHE_FILE = path.join(os.homedir(), '.sisyphus-desktop-repos.json');
let repoCache   = null;
let scanning    = false;
let lastScanTs  = 0;

function loadCacheFromDisk() {
  try {
    repoCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  } catch { repoCache = []; }
}

function scanInBackground(reposBase) {
  if (scanning) return;
  if (Date.now() - lastScanTs < 30000) return;
  lastScanTs = Date.now();
  scanning   = true;

  const script = `
const fs=require('fs'),path=require('path');
const BASES=${JSON.stringify(reposBase)};
function isGit(d){try{return fs.statSync(path.join(d,'.git')).isDirectory()}catch{return false}}
function toWin(p){return p.replace(/^\\/mnt\\/([a-z])\\//,(_, d)=>d.toUpperCase()+':\\\\\\\\').replace(/\\//g,'\\\\\\\\')}
function toWsl(p){return p.replace(/^([A-Za-z]):\\\\\\\\/,(_, d)=>'/mnt/'+d.toLowerCase()+'/').replace(/\\\\\\\\/g,'/')}
function tryWin(p){try{return fs.statSync(p)}catch{return null}}
function resolveBase(b){if(/^\\/mnt\\//.test(b)){const w=toWin(b);if(tryWin(w))return w;}return b;}
function scan(b,dep){
  if(dep>3)return[];const r=[];
  const rb=resolveBase(b);
  if(dep===0&&isGit(b)){try{r.push({name:path.basename(b),fullPath:b,mtime:fs.statSync(b).mtime.toISOString()})}catch{}}
  let entries;try{entries=fs.readdirSync(rb||b)}catch{return r}
  for(const n of entries){
    if(n.startsWith('.')||n==='node_modules'||n==='.next')continue;
    const f=path.join(rb||b,n);
    const fw=b!==rb?path.join(b,n):f;
    try{if(!fs.statSync(f).isDirectory())continue}catch{continue}
    if(isGit(f)){try{r.push({name:n,fullPath:fw,mtime:fs.statSync(f).mtime.toISOString()})}catch{};r.push(...scan(fw,dep+1))}
    else{r.push(...scan(fw,dep+1))}
  }
  return r;
}
const seen=new Set(),all=[];
for(const b of BASES){if(!fs.existsSync(resolveBase(b)||b))continue;for(const rr of scan(b,0)){if(!seen.has(rr.fullPath)){seen.add(rr.fullPath);all.push(rr)}}}
all.sort((a,b)=>b.mtime.localeCompare(a.mtime));
process.stdout.write(JSON.stringify(all));
`;

  const worker = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  let data = '';
  worker.stdout.on('data', c => data += c);
  worker.on('close', () => {
    try {
      repoCache = JSON.parse(data);
      fs.writeFileSync(CACHE_FILE, data, 'utf-8');
    } catch {}
    scanning = false;
  });
}

const PROGRESS_MAP_FILE = path.join(__dirname, '..', 'progress_map.json');
let progressMap = {};
try { progressMap = JSON.parse(fs.readFileSync(PROGRESS_MAP_FILE, 'utf-8')); } catch {}

let githubCache = null, githubCacheTs = 0;
const GITHUB_CACHE_TTL = 5 * 60 * 1000;
let progressCache = {}, progressCacheTs = 0;

function extractProgress(text) {
  const pats = [
    /진행률[:\s▸]*[\s\S]{0,30}?(\d+)\s*%/,
    /개발 진행률[:\s]*(\d+)\s*%/,
    /█+[░\s]*(\d+)\s*%/,
    /(\d+)\s*%\s*(완성|완료|진행)/,
  ];
  for (const pat of pats) {
    const m = text.match(pat);
    if (m) { const v = parseInt(m[1] || m[2]); if (!isNaN(v) && v >= 0 && v <= 100) return v; }
  }
  return 0;
}

function isCloned(repoName, cloneBase) {
  try { return fs.statSync(path.join(cloneBase, repoName, '.git')).isDirectory(); } catch { return false; }
}

function readBody(req) {
  return new Promise(resolve => {
    let d = '';
    req.on('data', c => d += c);
    req.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
  });
}

function jsonRes(res, data, status) {
  const body = Buffer.from(JSON.stringify(data));
  res.writeHead(status || 200, {
    'Content-Type': 'application/json',
    'Content-Length': body.length,
  });
  res.end(body);
}

const STATIC_CACHE = new Map();

function cacheStaticFile(fp) {
  try {
    if (!fs.statSync(fp).isFile()) return;
    const data = fs.readFileSync(fp);
    const etag = `"${crypto.createHash('md5').update(data).digest('hex')}"`;
    const gz   = zlib.gzipSync(data, { level: zlib.constants.Z_DEFAULT_COMPRESSION });
    const extMap = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
                     '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff2':'font/woff2' };
    const mime = extMap[path.extname(fp)] || 'application/octet-stream';
    STATIC_CACHE.set(fp, { data, gz, etag, mime });
  } catch {}
}

async function createServer({ port, pluginLoader, appRoot, rendererDir, envFile }) {
  loadEnvFile(envFile);

  const RENDERER = rendererDir || path.join(appRoot, 'renderer');

  const proxy = httpProxy.createProxyServer({ ws: true, changeOrigin: true });
  proxy.on('error', () => {});

  [1,2,3,4].forEach(n => startPanel(n, PANEL_PORTS[n], null));
  loadCacheFromDisk();
  const reposBase = getReposBase();
  const cloneBase = getCloneBase(reposBase);
  scanInBackground(reposBase);

  cacheStaticFile(path.join(RENDERER, 'index.html'));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const p   = url.pathname;

    const RB = getReposBase();
    const CB = getCloneBase(RB);

    if (p === '/api/config') {
      const injections = pluginLoader.getUIInjections();
      return jsonRes(res, {
        hasToken: !!getGithubToken(),
        cloneBase: CB,
        reposBase: RB,
        pluginInjections: injections,
      });
    }

    if (p === '/api/config/token' && req.method === 'POST') {
      const body = await readBody(req);
      const { token } = body;
      if (!token || (!token.startsWith('ghp_') && !token.startsWith('github_pat_')))
        return jsonRes(res, { error: 'Invalid token format' }, 400);
      try {
        let content = `GITHUB_TOKEN=${token}\n`;
        const existing = {};
        try {
          const raw = await fs.promises.readFile(envFile, 'utf-8');
          raw.split('\n').forEach(l => { const m = l.match(/^([A-Z_]+)=(.+)$/); if (m && m[1] !== 'GITHUB_TOKEN') existing[m[1]] = m[2]; });
        } catch {}
        for (const [k, v] of Object.entries(existing)) content += `${k}=${v}\n`;
        await fs.promises.writeFile(envFile, content, 'utf-8');
        process.env.GITHUB_TOKEN = token;
        githubCache = null;
        return jsonRes(res, { ok: true });
      } catch (e) { return jsonRes(res, { error: e.message }, 500); }
    }

    if (p === '/api/github/repos') {
      const token = getGithubToken();
      if (!token) return jsonRes(res, { error: 'NO_TOKEN', repos: [] });
      const force = url.searchParams.get('refresh') === '1';
      if (!force && githubCache && Date.now() - githubCacheTs < GITHUB_CACHE_TTL) {
        return jsonRes(res, { repos: githubCache.map(r => ({ ...r, cloned: isCloned(r.name, CB) })), total: githubCache.length, cached: true });
      }
      try {
        const repos = await fetchAllGithubRepos(token);
        githubCache = repos; githubCacheTs = Date.now();
        return jsonRes(res, { repos: repos.map(r => ({ ...r, cloned: isCloned(r.name, CB) })), total: repos.length });
      } catch (e) { return jsonRes(res, { error: e.message, repos: [] }, 500); }
    }

    if (p === '/api/github/clone' && req.method === 'POST') {
      const body = await readBody(req);
      const { repoName, cloneUrl } = body;
      if (!repoName || !cloneUrl) return jsonRes(res, { error: 'missing fields' }, 400);
      const targetDir = path.join(CB, repoName);
      if (isCloned(repoName, CB)) return jsonRes(res, { ok: true, localPath: wsl.winToWsl(targetDir), alreadyCloned: true });
      if (cloneProgress[repoName]?.status === 'cloning') return jsonRes(res, { ok: false, cloning: true, progress: cloneProgress[repoName] });

      cloneProgress[repoName] = { status: 'cloning', progress: 0 };
      fs.mkdirSync(path.dirname(targetDir), { recursive: true });

      const proc = wsl.wslSpawn(`git clone --progress ${JSON.stringify(cloneUrl)} ${JSON.stringify(wsl.winToWsl(targetDir))}`);
      const onData = (d) => {
        const msg = d.toString().trim(); if (!msg) return;
        const m = msg.match(/(\d+)%/);
        if (m) cloneProgress[repoName].progress = parseInt(m[1]);
        cloneProgress[repoName].msg = msg.substring(0, 80);
      };
      proc.stdout.on('data', onData); proc.stderr.on('data', onData);
      proc.on('close', code => {
        cloneProgress[repoName] = code === 0
          ? { status: 'done', progress: 100 }
          : { status: 'error', msg: cloneProgress[repoName]?.msg || `code ${code}` };
      });
      return jsonRes(res, { ok: true, cloning: true, localPath: wsl.winToWsl(targetDir) });
    }

    if (p === '/api/github/clone/progress') {
      const rn = url.searchParams.get('repo');
      const prog = cloneProgress[rn] || { status: 'unknown' };
      const done = isCloned(rn, CB);
      return jsonRes(res, { ...prog, done, localPath: done ? wsl.winToWsl(path.join(CB, rn)) : null });
    }

    if (p === '/api/github/clone/progress/stream') {
      const rn = url.searchParams.get('repo');
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
      const send = () => {
        const prog = cloneProgress[rn] || { status: 'unknown' };
        const done = isCloned(rn, CB);
        const payload = { progress: prog.progress||0, status: prog.status||'unknown', done, localPath: done ? wsl.winToWsl(path.join(CB, rn)) : null, error: prog.status==='error'?(prog.msg||null):null };
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
        return payload;
      };
      send();
      const iv = setInterval(() => { const pl = send(); if (pl.done || pl.status==='error') { clearInterval(iv); res.end(); } }, 300);
      req.on('close', () => clearInterval(iv));
      return;
    }

    if (p === '/api/opencode/sessions') {
      const dir = url.searchParams.get('dir') || '';
      return jsonRes(res, queryOcSessions(dir));
    }

    if (p === '/api/project-detail') {
      const repoName = url.searchParams.get('repo');
      if (!repoName) return jsonRes(res, { error: 'no repo' }, 400);
      const bases = [...new Set([...RB, CB].filter(Boolean))];
      let text = '';
      for (const base of bases) {
        const baseWin = wsl.resolveForFs(base);
        for (const fname of ['프로젝트_개요.txt', 'README.md']) {
          try { text = await fs.promises.readFile(path.join(baseWin, repoName, fname), 'utf-8'); break; } catch {}
        }
        if (text) break;
      }
      const getSection = (header) => { const m = text.match(new RegExp(`■\\s*${header}[^\\n]*\\n([\\s\\S]*?)(?=\\n■|$)`)); return m ? m[1].trim() : ''; };
      const tech = getSection('기술 스택').split('\n').filter(l=>l.trim().startsWith('-')).map(l=>l.trim().replace(/^-\s*/,'').split(':').pop().trim()).filter(Boolean);
      const done = getSection('완료된 작업').split('\n').filter(l=>l.includes('✅')).map(l=>l.replace(/.*✅\s*/,'').trim()).filter(Boolean);
      const todo = getSection('남은 작업').split('\n').filter(l=>l.includes('□')).map(l=>l.replace(/.*□\s*/,'').trim()).filter(Boolean);
      const pct = progressCache[repoName] ?? progressMap[repoName] ?? 0;
      return jsonRes(res, {
        name: repoName, progress: pct, hasDetail: !!text,
        type: getSection('프로젝트 유형').split('\n')[0]?.trim() || '',
        purpose: getSection('프로젝트 목적').split('\n')[0]?.trim() || '',
        tech, done, todo,
        updated: (text.match(/최종 업데이트[:\s]*(.+)/)||[])[1]?.trim() || '',
        eta:     (text.match(/예상\s*작업[:\s]*(.+)/)||[])[1]?.trim()  || '',
      });
    }

    if (p === '/api/progress') {
      const now = Date.now();
      if (progressCacheTs && now - progressCacheTs < 120000) return jsonRes(res, progressCache);
      const result = { ...progressMap };
      const bases = [...new Set([...RB, CB].filter(Boolean))];
      await Promise.all(bases.map(async base => {
        const baseWin = wsl.resolveForFs(base);
        try {
          const names = await fs.promises.readdir(baseWin);
          await Promise.all(names.map(async name => {
            try {
              await fs.promises.access(path.join(baseWin, name, '.git'));
              let text = '';
              for (const fname of ['README.md', '프로젝트_개요.txt']) {
                try { text = await fs.promises.readFile(path.join(baseWin, name, fname), 'utf-8'); break; } catch {}
              }
              const parsed = extractProgress(text);
              if (parsed > 0) result[name] = parsed;
            } catch {}
          }));
        } catch {}
      }));
      Object.assign(progressCache, result);
      progressCacheTs = now;
      return jsonRes(res, result);
    }

    if (p === '/api/repos') {
      if (url.searchParams.get('refresh') === '1') scanInBackground(RB);
      const q = (url.searchParams.get('q') || '').toLowerCase();
      let repos = repoCache || [];
      if (q) repos = repos.filter(r => r.name.toLowerCase().includes(q) || r.fullPath.toLowerCase().includes(q));
      return jsonRes(res, { repos, total: repos.length, scanning });
    }

    if (p === '/api/browse') {
      const dir = url.searchParams.get('dir') || '/mnt';
      const winDir = wsl.resolveForFs(dir);
      try {
        const entries = await fs.promises.readdir(winDir);
        const checks = await Promise.allSettled(
          entries.filter(n => !n.startsWith('.')).map(async name => {
            const full = path.join(winDir, name);
            const stat = await fs.promises.stat(full);
            if (!stat.isDirectory()) return null;
            const isGit = await fs.promises.access(path.join(full, '.git')).then(() => true).catch(() => false);
            const wslFull = wsl.winToWsl(full);
            return { name, fullPath: wslFull || full, isGit };
          })
        );
        const items = checks.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value)
          .sort((a, b) => { if (a.isGit !== b.isGit) return a.isGit ? -1 : 1; return a.name.localeCompare(b.name, 'ko'); });
        const parent = dir !== '/' && dir !== '/mnt' ? path.posix.dirname(dir) : null;
        return jsonRes(res, { dir, parent, items });
      } catch (e) { return jsonRes(res, { error: e.message, dir, parent: null, items: [] }); }
    }

    if (p === '/api/panel/launch' && req.method === 'POST') {
      const body = await readBody(req);
      const n = Number(body.panelId);
      if (!PANEL_PORTS[n]) return jsonRes(res, { error: 'bad panel' }, 400);
      await startPanel(n, PANEL_PORTS[n], body.repoDir || null, body.sessionId || null);
      return jsonRes(res, { ok: true, panel: n, mode: panelState[n]?.mode });
    }

    if (p === '/api/panel/stop' && req.method === 'POST') {
      const body = await readBody(req);
      await startPanel(Number(body.panelId), PANEL_PORTS[Number(body.panelId)], null);
      return jsonRes(res, { ok: true });
    }

    if (p === '/api/panel/status') return jsonRes(res, panelState);

    if (p === '/api/panel/ready') {
      const panelId = Number(url.searchParams.get('panelId'));
      const port    = PANEL_PORTS[panelId];
      if (!port) return jsonRes(res, { error: 'bad panelId' }, 400);
      const timeout = 15000, interval = 200, start = Date.now();
      const poll = () => {
        if (Date.now() - start >= timeout) return jsonRes(res, { ready: false, timeout: true });
        const req2 = http.get(`http://127.0.0.1:${port}/`, (r) => {
          if (r.statusCode === 200) { r.resume(); return jsonRes(res, { ready: true, panelId }); }
          r.resume(); setTimeout(poll, interval);
        });
        req2.on('error', () => setTimeout(poll, interval));
        req2.setTimeout(1000, () => { req2.destroy(); setTimeout(poll, interval); });
      };
      poll(); return;
    }

    if (p === '/api/plugins') {
      return jsonRes(res, pluginLoader.getList());
    }

    if (p === '/api/plugins/install' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        await pluginLoader.installFromGithub(body.url);
        return jsonRes(res, { ok: true });
      } catch (e) { return jsonRes(res, { ok: false, error: e.message }, 500); }
    }

    for (const route of pluginLoader.routes) {
      if (route.method === req.method && route.path === p) {
        try { await route.handler(req, res, url); } catch (e) { jsonRes(res, { error: e.message }, 500); }
        return;
      }
    }

    const tmatch = p.match(TERMINAL_RE);
    if (tmatch) {
      const n = Number(tmatch[1]);
      const pport = PANEL_PORTS[n];
      const sub = (tmatch[2] || '/');
      if (sub === '/' || sub === '') {
        if (ttydHtmlCache) {
          res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': Buffer.byteLength(ttydHtmlCache) });
          return res.end(ttydHtmlCache);
        }
        req.url = '/';
        return proxy.web(req, res, { target: `http://127.0.0.1:${pport}`, agent: TTYD_AGENTS[pport] });
      }
      req.url = sub;
      return proxy.web(req, res, { target: `http://127.0.0.1:${pport}`, agent: TTYD_AGENTS[pport] });
    }

    const indexPath = path.join(RENDERER, 'index.html');
    const filePath  = p === '/' ? indexPath : path.join(RENDERER, p);
    const isIndex   = filePath === indexPath;

    if (isIndex) {
      try {
        const data = await fs.promises.readFile(indexPath);
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        return res.end(data);
      } catch { res.writeHead(404); return res.end(); }
    }

    const entry = STATIC_CACHE.get(filePath);
    if (entry) {
      if (req.headers['if-none-match'] === entry.etag) { res.writeHead(304); return res.end(); }
      const acceptGzip = /gzip/.test(req.headers['accept-encoding'] || '');
      const headers = { 'Content-Type': entry.mime, 'ETag': entry.etag, 'Cache-Control': 'no-cache' };
      if (acceptGzip) { headers['Content-Encoding'] = 'gzip'; res.writeHead(200, headers); return res.end(entry.gz); }
      res.writeHead(200, headers); return res.end(entry.data);
    }

    try {
      const data = await fs.promises.readFile(filePath);
      res.writeHead(200); res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });

  server.on('upgrade', (req, socket, head) => {
    const m = req.url.match(TERMINAL_RE);
    if (m) {
      const pport = PANEL_PORTS[Number(m[1])];
      req.url = '/ws';
      proxy.ws(req, socket, head, { target: `ws://127.0.0.1:${pport}`, agent: TTYD_AGENTS[pport] });
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`  SISYPHUS DESKTOP  http://localhost:${port}`);
      setTimeout(() => {
        http.get(`http://127.0.0.1:${PANEL_PORTS[1]}/`, (r) => {
          let d = ''; r.on('data', c => d += c); r.on('end', () => { ttydHtmlCache = d; });
        }).on('error', () => {});
      }, 1000);
      resolve(server);
    });
    server.on('error', reject);
  });
}

process.on('exit', () => {
  Object.values(ttydProcs).forEach(p => { try { p.kill('SIGKILL'); } catch {} });
});

module.exports = { createServer };
