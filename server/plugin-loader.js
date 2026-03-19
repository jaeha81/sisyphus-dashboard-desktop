'use strict';

const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const zlib    = require('zlib');
const crypto  = require('crypto');
const { execSync } = require('child_process');

class PluginLoader {
  constructor(pluginsDir) {
    this.dir      = path.resolve(pluginsDir);
    this.plugins  = new Map();
    this.routes   = [];
    this._stateFile = path.join(path.resolve(pluginsDir), '.state.json');
    this._state   = {};
  }

  _loadState() {
    try {
      this._state = JSON.parse(fs.readFileSync(this._stateFile, 'utf-8'));
    } catch {
      this._state = {};
    }
  }

  _saveState() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this._stateFile, JSON.stringify(this._state, null, 2));
    } catch {}
  }

  async load() {
    this._loadState();
    if (!fs.existsSync(this.dir)) return;

    const entries = fs.readdirSync(this.dir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'));

    for (const entry of entries) {
      await this._loadOne(entry.name).catch(e =>
        console.error(`[plugin:${entry.name}] load error:`, e.message)
      );
    }
  }

  async _loadOne(id) {
    const dir      = path.join(this.dir, id);
    const manifest = path.join(dir, 'plugin.json');
    if (!fs.existsSync(manifest)) return;

    const meta = JSON.parse(fs.readFileSync(manifest, 'utf-8'));
    const enabled = this._state[id]?.enabled !== false;
    let mod = null;

    if (enabled) {
      try {
        const mainFile = path.join(dir, meta.main || 'index.js');
        mod = require(mainFile);
      } catch (e) {
        console.error(`[plugin:${id}] require error:`, e.message);
      }
    }

    this.plugins.set(id, { id, meta, mod, dir, enabled });

    if (mod?.registerRoutes) {
      const bucket = [];
      mod.registerRoutes({
        get:    (p, h) => bucket.push({ method: 'GET',    path: p, handler: h }),
        post:   (p, h) => bucket.push({ method: 'POST',   path: p, handler: h }),
        delete: (p, h) => bucket.push({ method: 'DELETE', path: p, handler: h }),
      });
      this.routes.push(...bucket.map(r => ({ ...r, pluginId: id })));
    }
  }

  getList() {
    return [...this.plugins.values()].map(p => ({
      id:          p.id,
      name:        p.meta.name        || p.id,
      version:     p.meta.version     || '0.0.0',
      description: p.meta.description || '',
      author:      p.meta.author      || '',
      enabled:     p.enabled,
      hasUI:       !!p.mod?.getUICode,
    }));
  }

  getUIInjections() {
    const injections = [];
    for (const p of this.plugins.values()) {
      if (!p.enabled || !p.mod?.getUICode) continue;
      try {
        injections.push({ id: p.id, name: p.meta.name, ...p.mod.getUICode() });
      } catch {}
    }
    return injections;
  }

  toggle(id) {
    const p = this.plugins.get(id);
    if (!p) throw new Error(`Plugin ${id} not found`);
    p.enabled = !p.enabled;
    if (!this._state[id]) this._state[id] = {};
    this._state[id].enabled = p.enabled;
    this._saveState();
    return p.enabled;
  }

  async remove(id) {
    const p = this.plugins.get(id);
    if (!p) throw new Error(`Plugin ${id} not found`);
    this.plugins.delete(id);
    this.routes = this.routes.filter(r => r.pluginId !== id);
    delete this._state[id];
    this._saveState();
    await fs.promises.rm(p.dir, { recursive: true, force: true });
  }

  async installFromGithub(githubUrl) {
    const m = githubUrl.match(/github\.com\/([^/]+)\/([^/\s#]+)/);
    if (!m) throw new Error('Invalid GitHub URL');
    const [, owner, repo] = m;
    const pluginId = repo.replace(/^sisyphus-plugin-/, '');
    const destDir  = path.join(this.dir, pluginId);

    if (fs.existsSync(destDir)) throw new Error(`Plugin "${pluginId}" already exists`);

    const zipUrl  = `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/main`;
    const tmpZip  = path.join(this.dir, `_tmp_${crypto.randomBytes(4).toString('hex')}.zip`);

    await this._download(zipUrl, tmpZip);

    fs.mkdirSync(destDir, { recursive: true });
    execSync(`cd ${JSON.stringify(this.dir)} && unzip -q ${JSON.stringify(tmpZip)} -d ${JSON.stringify(destDir + '_unzip')}`, { timeout: 30000 });
    fs.unlinkSync(tmpZip);

    const unzipDir   = destDir + '_unzip';
    const innerDirs  = fs.readdirSync(unzipDir, { withFileTypes: true }).filter(d => d.isDirectory());
    const innerRoot  = innerDirs.length === 1 ? path.join(unzipDir, innerDirs[0].name) : unzipDir;

    fs.renameSync(innerRoot, destDir);
    if (fs.existsSync(unzipDir)) await fs.promises.rm(unzipDir, { recursive: true }).catch(() => {});

    await this._loadOne(pluginId);
  }

  _download(url, dest) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https.get(url, { headers: { 'User-Agent': 'sisyphus-dashboard' } }, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          file.close(() => this._download(res.headers.location, dest).then(resolve).catch(reject));
          return;
        }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      }).on('error', reject);
    });
  }

  unloadAll() {
    for (const p of this.plugins.values()) {
      try { if (p.mod?.onUnload) p.mod.onUnload(); } catch {}
    }
  }
}

module.exports = { PluginLoader };
