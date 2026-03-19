'use strict';

const os  = require('os');
const { execSync } = require('child_process');

let _lastCpu = null;

function getCpuPercent() {
  const cpus = os.cpus();
  if (!_lastCpu) { _lastCpu = cpus; return 0; }
  let idle = 0, total = 0;
  cpus.forEach((c, i) => {
    const prev = _lastCpu[i];
    const di = c.times.idle  - prev.times.idle;
    const dt = Object.values(c.times).reduce((a, v) => a + v, 0)
             - Object.values(prev.times).reduce((a, v) => a + v, 0);
    idle  += di;
    total += dt;
  });
  _lastCpu = cpus;
  return total === 0 ? 0 : Math.round((1 - idle / total) * 100);
}

function getDiskFree() {
  try {
    const out = execSync('wmic logicaldisk where "DeviceID=\'C:\'" get FreeSpace,Size /format:csv', {
      encoding: 'utf-8', timeout: 3000,
    });
    const lines = out.trim().split('\n').filter(Boolean);
    const data  = lines[lines.length - 1].split(',');
    const free  = parseInt(data[1]);
    const size  = parseInt(data[2]);
    if (isNaN(free) || isNaN(size) || size === 0) return null;
    return { free, size, usedPct: Math.round((1 - free / size) * 100) };
  } catch { return null; }
}

function getStats() {
  const mem      = { total: os.totalmem(), free: os.freemem() };
  mem.usedPct    = Math.round((1 - mem.free / mem.total) * 100);
  const cpu      = getCpuPercent();
  const disk     = getDiskFree();
  const loadAvg  = os.loadavg()[0];
  return { cpu, mem, disk, loadAvg };
}

module.exports = {
  registerRoutes(router) {
    router.get('/api/plugin/system-monitor', async (_req, res) => {
      const stats = getStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
    });
  },

  getUICode() {
    return {
      html: `
<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:9px">
  <div id="sm-cpu" style="background:rgba(0,0,0,.3);border:1px solid var(--border);border-radius:4px;padding:6px">
    <div style="color:var(--muted);margin-bottom:3px;letter-spacing:.1em">CPU</div>
    <div id="sm-cpu-val" style="font-size:16px;font-weight:700;color:var(--cyan)">--%</div>
    <div style="height:2px;background:var(--dim);border-radius:2px;margin-top:4px"><div id="sm-cpu-bar" style="height:100%;width:0%;background:var(--cyan);border-radius:2px;transition:width .5s"></div></div>
  </div>
  <div style="background:rgba(0,0,0,.3);border:1px solid var(--border);border-radius:4px;padding:6px">
    <div style="color:var(--muted);margin-bottom:3px;letter-spacing:.1em">MEM</div>
    <div id="sm-mem-val" style="font-size:16px;font-weight:700;color:var(--purple)">--%</div>
    <div style="height:2px;background:var(--dim);border-radius:2px;margin-top:4px"><div id="sm-mem-bar" style="height:100%;width:0%;background:var(--purple);border-radius:2px;transition:width .5s"></div></div>
  </div>
  <div style="background:rgba(0,0,0,.3);border:1px solid var(--border);border-radius:4px;padding:6px;grid-column:span 2">
    <div style="color:var(--muted);margin-bottom:3px;letter-spacing:.1em">DISK C:</div>
    <div id="sm-disk-val" style="font-size:11px;color:var(--amber)">검색 중...</div>
    <div style="height:2px;background:var(--dim);border-radius:2px;margin-top:4px"><div id="sm-disk-bar" style="height:100%;width:0%;background:var(--amber);border-radius:2px;transition:width .5s"></div></div>
  </div>
</div>`,
      js: `
(function(el){
  function gb(b){return(b/1e9).toFixed(1)+'GB'}
  function color(pct){return pct>=90?'var(--red)':pct>=70?'var(--amber)':''}
  async function tick(){
    try{
      const r=await fetch('/api/plugin/system-monitor');
      const d=await r.json();
      const cv=el.querySelector('#sm-cpu-val');
      const cb=el.querySelector('#sm-cpu-bar');
      const mv=el.querySelector('#sm-mem-val');
      const mb=el.querySelector('#sm-mem-bar');
      const dv=el.querySelector('#sm-disk-val');
      const db=el.querySelector('#sm-disk-bar');
      if(cv){cv.textContent=d.cpu+'%';cv.style.color=color(d.cpu)||'var(--cyan)';if(cb)cb.style.width=d.cpu+'%';}
      if(mv&&d.mem){mv.textContent=d.mem.usedPct+'%';mv.style.color=color(d.mem.usedPct)||'var(--purple)';if(mb)mb.style.width=d.mem.usedPct+'%';}
      if(dv&&d.disk){dv.textContent=d.disk.usedPct+'% ('+gb(d.disk.size-d.disk.free)+' / '+gb(d.disk.size)+')';dv.style.color=color(d.disk.usedPct)||'var(--amber)';if(db)db.style.width=d.disk.usedPct+'%';}
    }catch{}
  }
  tick();setInterval(tick,5000);
})(el);
`,
    };
  },
};
