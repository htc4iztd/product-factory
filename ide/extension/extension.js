// Product Factory のリポジトリを読み取り専用で開くファイルシステム。
// URI は pfrepo://<プロダクトID>/<パス>。ファイルはアプリの API（/api/p/<id>/code/...）から取る。
const vscode = require("vscode");

function base() {
  return vscode.workspace.getConfiguration("pfrepo").get("apiBase") || "";
}

class RepoFS {
  constructor() {
    this.trees = new Map(); // プロダクトID → Promise<Map<path, {type, size}>>
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeFile = this._emitter.event;
  }

  tree(pid) {
    if (!this.trees.has(pid)) {
      this.trees.set(pid, fetch(`${base()}/api/p/${encodeURIComponent(pid)}/code/tree`, { credentials: "include" })
        .then(async (r) => {
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `一覧を取れません（${r.status}）`);
          const data = await r.json();
          const m = new Map([["", { type: "dir", size: 0 }]]);
          for (const e of data.entries) m.set(e.path, { type: e.type, size: e.size || 0 });
          if (data.truncated) vscode.window.showWarningMessage("ファイルが多いため、一覧の一部だけを表示しています");
          return m;
        })
        .catch((e) => { this.trees.delete(pid); throw e; }));
    }
    return this.trees.get(pid);
  }

  key(uri) { return uri.path.replace(/^\/+|\/+$/g, ""); }

  async stat(uri) {
    const e = (await this.tree(uri.authority)).get(this.key(uri));
    if (!e) throw vscode.FileSystemError.FileNotFound(uri);
    return {
      type: e.type === "dir" ? vscode.FileType.Directory : vscode.FileType.File,
      ctime: 0, mtime: 0, size: e.size, permissions: vscode.FilePermission.Readonly,
    };
  }

  async readDirectory(uri) {
    const dir = this.key(uri);
    const prefix = dir ? dir + "/" : "";
    const out = [];
    for (const [p, e] of await this.tree(uri.authority)) {
      if (!p || !p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      if (rest.includes("/")) continue;
      out.push([rest, e.type === "dir" ? vscode.FileType.Directory : vscode.FileType.File]);
    }
    return out;
  }

  async readFile(uri) {
    // 木にないパス（.vscode/settings.json など、IDE が勝手に探しに行くもの）は問い合わせない
    const e = (await this.tree(uri.authority)).get(this.key(uri));
    if (!e || e.type === "dir") throw vscode.FileSystemError.FileNotFound(uri);
    const r = await fetch(`${base()}/api/p/${encodeURIComponent(uri.authority)}/code/file?path=${encodeURIComponent(this.key(uri))}`, { credentials: "include" });
    if (r.status === 404) throw vscode.FileSystemError.FileNotFound(uri);
    if (!r.ok) throw vscode.FileSystemError.Unavailable(`読めません（${r.status}）`);
    return new Uint8Array(await r.arrayBuffer());
  }

  watch() { return new vscode.Disposable(() => {}); }
  createDirectory(uri) { throw vscode.FileSystemError.NoPermissions(uri); }
  writeFile(uri) { throw vscode.FileSystemError.NoPermissions(uri); }
  delete(uri) { throw vscode.FileSystemError.NoPermissions(uri); }
  rename(uri) { throw vscode.FileSystemError.NoPermissions(uri); }
}

function activate(context) {
  const fs = new RepoFS();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider("pfrepo", fs, { isCaseSensitive: true, isReadonly: true }),
  );
}

module.exports = { activate };
