import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "./theme";
import { themeList, type ThemeId } from "./theme";
import "./App.css";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";

// ---- Types ----
type Mode = "compress" | "extract";
type CompLevel = 0 | 1 | 2 | 3 | 5 | 7 | 9;
type ArchiveFormat = "zip" | "7z" | "tar" | "gz" | "bz2" | "xz" | "lzma" | "zst" | "iso" | "cab" | "arj" | "lzh" | "wim";
interface FileEntry { id: string; name: string; path: string; size: number; }
interface ArchiveEntry { name: string; size: number; compressed_size: number; is_dir: boolean; }
interface TreeNode { name: string; full: string; isDir: boolean; size: number; compressed: number; children: TreeNode[]; }

// 精简后的压缩档位（去掉重复/冗余，保留清晰的 5 档）
const LEVELS: { value: CompLevel; label: string; hint: string }[] = [
  { value: 0, label: "存储", hint: "不压缩" },
  { value: 3, label: "快速", hint: "速度优先" },
  { value: 5, label: "标准", hint: "均衡" },
  { value: 7, label: "最优", hint: "高压缩" },
  { value: 9, label: "极限", hint: "最小体积" },
];
const FORMAT_LABELS: Record<ArchiveFormat, string> = { "7z": "7z (高压缩)", zip: "ZIP (通用)", tar: "TAR (归档)", gz: "GZip (.gz)", bz2: "BZip2 (.bz2)", xz: "XZ (.xz)", lzma: "LZMA", zst: "Zstd", iso: "ISO (光盘镜像)", cab: "CAB (微软)", arj: "ARJ", lzh: "LZH", wim: "WIM (映像)" };
const FORMAT_EXT: Record<ArchiveFormat, string> = { zip: ".zip", "7z": ".7z", tar: ".tar", gz: ".gz", bz2: ".bz2", xz: ".xz", lzma: ".lzma", zst: ".zst", iso: ".iso", cab: ".cab", arj: ".arj", lzh: ".lzh", wim: ".wim" };
const ARCHIVE_EXTS = [".zip", ".zip.001", ".7z", ".7z.001", ".rar", ".r00", ".tar", ".tar.gz", ".tar.bz2", ".tar.xz", ".tar.zst", ".gz", ".bz2", ".xz", ".iso", ".cab", ".arj", ".lzh", ".zst", ".lzma", ".wim", ".cpio", ".lha", ".tgz", ".tbz2", ".txz", ".tzst"];

function fmtSize(bytes: number): string { if (bytes < 1024) return bytes + " B"; if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB"; if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB"; return (bytes / 1073741824).toFixed(2) + " GB"; }
function basename(p: string): string { const s = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/")); return s === -1 ? p : p.slice(s + 1); }
function dirname(p: string): string { const s = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/")); return s === -1 ? "" : p.slice(0, s); }
function stripExt(p: string): string { const b = basename(p); const known = ['.tar.gz','.tar.bz2','.tar.xz','.tar.zst','.tgz','.tbz2','.txz','.tzst']; for (const k of known) { if (b.endsWith(k)) return p.slice(0, p.length - k.length); } const d = p.lastIndexOf("."); if (d === -1) return p; const s = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/")); return d > s ? p.slice(0, d) : p; }
function rtrimBackslash(s: string): string { let i = s.length; while (i > 0 && (s.charCodeAt(i - 1) === 92 || s.charCodeAt(i - 1) === 47)) i--; return s.slice(0, i); }
function isArchive(f: string): boolean { const low = f.toLowerCase(); for (const ext of ARCHIVE_EXTS) { if (low.endsWith(ext)) return true; } return false; }
let uid = 0; const nextId = () => "f" + (++uid);

// 把扁平的压缩包条目构建成文件夹树
function buildTree(entries: ArchiveEntry[]): TreeNode[] {
  const root: TreeNode = { name: "", full: "", isDir: true, size: 0, compressed: 0, children: [] };
  const dirMap = new Map<string, TreeNode>([["", root]]);
  const ensureDir = (full: string): TreeNode => {
    const cached = dirMap.get(full);
    if (cached) return cached;
    const idx = full.lastIndexOf("/");
    const parent = ensureDir(idx === -1 ? "" : full.slice(0, idx));
    const node: TreeNode = { name: idx === -1 ? full : full.slice(idx + 1), full, isDir: true, size: 0, compressed: 0, children: [] };
    parent.children.push(node); dirMap.set(full, node);
    return node;
  };
  for (const e of entries) {
    const norm = e.name.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!norm) continue;
    if (e.is_dir) { ensureDir(norm); continue; }
    const idx = norm.lastIndexOf("/");
    const parent = ensureDir(idx === -1 ? "" : norm.slice(0, idx));
    parent.children.push({ name: idx === -1 ? norm : norm.slice(idx + 1), full: e.name, isDir: false, size: e.size, compressed: e.compressed_size, children: [] });
  }
  const sortRec = (n: TreeNode) => { n.children.sort((a, b) => a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)); n.children.forEach(sortRec); };
  sortRec(root);
  return root.children;
}

// 收集某节点下所有文件的原始条目名（用于删除/选择）
function collectFiles(node: TreeNode, out: string[]) { if (node.isDir) node.children.forEach(c => collectFiles(c, out)); else out.push(node.full); }

// ---- Tauri bridge ----
async function call(cmd: string, args?: Record<string, unknown>): Promise<unknown> { return tauriInvoke(cmd, args ?? {}); }
async function fileInfo(p: string): Promise<{ size: number; is_dir: boolean } | null> {
  try { return JSON.parse((await call("get_file_info", { path: p })) as string) as { size: number; is_dir: boolean }; } catch { return null; }
}
async function tauriPickFiles(): Promise<{ name: string; path: string; size: number }[]> { try { const selected = await dialogOpen({ multiple: true }); if (!selected) return []; const paths = Array.isArray(selected) ? selected : [selected]; const r: { name: string; path: string; size: number }[] = []; for (const p of paths) { const info = await fileInfo(p); r.push({ name: basename(p), path: p, size: info?.size ?? 0 }); } return r; } catch { return []; } }
async function tauriPickFolders(): Promise<{ name: string; path: string; size: number }[]> { try { const selected = await dialogOpen({ multiple: true, directory: true, title: '选择文件夹' }); if (!selected) return []; const paths = Array.isArray(selected) ? selected : [selected]; const r: { name: string; path: string; size: number }[] = []; for (const p of paths) { const info = await fileInfo(p); r.push({ name: basename(p), path: p, size: info?.size ?? 0 }); } return r; } catch { return []; } }
async function tauriPickArchive(): Promise<string> { try { const selected = await dialogOpen({ multiple: false, filters: [{ name: '所有压缩包', extensions: ['zip','7z','rar','tar','gz','bz2','xz','iso','cab','arj','lzh','zst','lzma','wim','cpio','lha','z','txz','tgz','tbz2','tzst','001','r00'] }] }); return selected ? (Array.isArray(selected) ? selected[0] : selected) : ''; } catch { return ''; } }
async function tauriListArchive(path: string, pw?: string): Promise<ArchiveEntry[]> { try { return (await call("list_archive", { path, password: pw ?? "" })) as ArchiveEntry[]; } catch { return []; } }
async function tauriExtract(archivePath: string, outputDir: string, password?: string): Promise<{ path: string }> { const r = (await call("extract_archive", { archivePath, outputDir, password: password ?? "" })) as string; return JSON.parse(r); }
async function tauriPickFolder(): Promise<string> { try { const selected = await dialogOpen({ multiple: false, directory: true, title: '选择目录' }); return selected ? (Array.isArray(selected) ? selected[0] : selected) : ''; } catch { return ''; } }
async function tauriCompress(inputPaths: string[], outputPath: string, format: ArchiveFormat, level: CompLevel, password?: string, volume?: string): Promise<{ path: string; size: number }> { const r = (await call("compress_files", { inputPaths, outputPath, format, level, password: password ?? "", volume: volume ?? "" })) as string; return JSON.parse(r); }
async function tauriTest(archivePath: string, password?: string): Promise<{ ok: boolean; detail: string }> { return JSON.parse((await call("test_archive", { archivePath, password: password ?? "" })) as string); }
async function tauriAdd(archivePath: string, inputPaths: string[], password?: string): Promise<{ path: string; size: number }> { return JSON.parse((await call("add_to_archive", { archivePath, inputPaths, password: password ?? "" })) as string); }
async function tauriDelete(archivePath: string, entries: string[], password?: string): Promise<{ path: string; size: number }> { return JSON.parse((await call("delete_from_archive", { archivePath, entries, password: password ?? "" })) as string); }
async function tauriOpenEntry(archivePath: string, entry: string, password?: string): Promise<void> { await call("extract_and_open", { archivePath, entry, password: password ?? "" }); }
async function tauriReveal(path: string): Promise<void> { try { await call("reveal_in_explorer", { path }); } catch { } }

// ---- Progress Bar ----
function ProgressBar({ value, label }: { value: number; label: string }) {
  return (<div className="progress-wrap">
    <div className="progress-meta"><span className="progress-label">{label}</span><span className="progress-pct">{value}%</span></div>
    <div className="progress-track"><div className="progress-fill" style={{ width: value + "%" }} /></div>
  </div>);
}

// ---- Settings Panel ----
function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme, setThemeId } = useTheme(); if (!open) return null;
  return (<div className="settings-overlay" onClick={onClose}><div className="settings-panel" onClick={e => e.stopPropagation()}>
    <div className="settings-header"><h2>{'设置'}</h2><button className="close-btn" onClick={onClose}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button></div>
    <section className="settings-section"><h3>{'主题'}</h3><div className="theme-grid">{themeList.map(t => (<button key={t.id} className={"theme-card " + (theme.id === t.id ? "active" : "")} onClick={() => setThemeId(t.id as ThemeId)} data-theme-card={t.id}><div className="theme-preview" data-theme-preview={t.id}><span className="preview-dot" /><span className="preview-bar" /></div><span className="theme-label">{t.label}</span></button>))}</div></section>
    <section className="settings-section"><h3>{'关于'}</h3><p className="about-text">uiZip — 精美的 Windows 压缩工具。基于 Tauri + React，内置 7-Zip 引擎。</p></section>
  </div></div>);
}

// ---- Context Menu ----
function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: { label: string; onClick: () => void }[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, [onClose]);
  const pos = { left: Math.min(x, window.innerWidth - 180), top: Math.min(y, window.innerHeight - items.length * 36 - 8) };
  return (<div ref={ref} className="context-menu" style={pos}>{items.map((it, i) => (<button key={i} className="ctx-item" onClick={() => { it.onClick(); onClose(); }}>{it.label}</button>))}</div>);
}

// ---- Archive Tree ----
function TreeRows({ nodes, depth, expanded, toggleExpand, selected, toggleSelect, onOpen }: {
  nodes: TreeNode[]; depth: number; expanded: Set<string>; toggleExpand: (f: string) => void;
  selected: Set<string>; toggleSelect: (n: TreeNode) => void; onOpen: (n: TreeNode) => void;
}) {
  return (<>{nodes.map(n => {
    const files: string[] = []; collectFiles(n, files);
    const checked = files.length > 0 && files.every(f => selected.has(f));
    const partial = !checked && files.some(f => selected.has(f));
    const isOpen = expanded.has(n.full);
    return (<div key={n.full || n.name}>
      <div className={"tree-row " + (n.isDir ? "is-dir" : "is-file")} style={{ paddingLeft: 10 + depth * 18 }} onDoubleClick={() => n.isDir ? toggleExpand(n.full) : onOpen(n)}>
        <input type="checkbox" className="tree-check" checked={checked} ref={el => { if (el) el.indeterminate = partial; }} onChange={() => toggleSelect(n)} onClick={e => e.stopPropagation()} />
        {n.isDir ? (
          <button className={"tree-chevron " + (isOpen ? "open" : "")} onClick={() => toggleExpand(n.full)}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 6 15 12 9 18" /></svg></button>
        ) : <span className="tree-chevron-space" />}
        <span className="tree-icon">{n.isDir
          ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="folder-icon"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
          : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>}</span>
        <span className="tree-name">{n.name}</span>
        <span className="tree-size">{n.isDir ? "" : fmtSize(n.size)}</span>
        <span className="tree-compressed">{n.isDir ? "" : fmtSize(n.compressed)}</span>
        <span className="tree-actions">
          {!n.isDir && <button className="tree-act" title={'预览 / 打开'} onClick={e => { e.stopPropagation(); onOpen(n); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg></button>}
        </span>
      </div>
      {n.isDir && isOpen && n.children.length > 0 && <TreeRows nodes={n.children} depth={depth + 1} expanded={expanded} toggleExpand={toggleExpand} selected={selected} toggleSelect={toggleSelect} onOpen={onOpen} />}
    </div>);
  })}</>);
}

// ---- Main App ----
export default function App() {
  const { theme, toggleDark } = useTheme();
  const [mode, setMode] = useState<Mode>("compress");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [outputDir, setOutputDir] = useState("");
  const [compLevel, setCompLevel] = useState<CompLevel>(5);
  const [compFormat, setCompFormat] = useState<ArchiveFormat>("zip");
  const [compPassword, setCompPassword] = useState("");
  const [showCompPassword, setShowCompPassword] = useState(false);
  const [volume, setVolume] = useState("");
  const [compressing, setCompressing] = useState(false);
  const [compDone, setCompDone] = useState(false);
  const [compResult, setCompResult] = useState<{ path: string; size: number } | null>(null);
  const [compError, setCompError] = useState("");

  const [archivePath, setArchivePath] = useState("");
  const [archiveEntries, setArchiveEntries] = useState<ArchiveEntry[]>([]);
  const [extractDir, setExtractDir] = useState("");
  const [extractPassword, setExtractPassword] = useState("");
  const [showExtractPassword, setShowExtractPassword] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractDone, setExtractDone] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyOp, setBusyOp] = useState<"" | "test" | "add" | "delete">("");

  const [progress, setProgress] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: { label: string; onClick: () => void }[] } | null>(null);
  const [dragover, setDragover] = useState(false);
  const [toastMsg, setToastMsg] = useState("");

  useEffect(() => { if (toastMsg) { const t = setTimeout(() => setToastMsg(""), 3000); return () => clearTimeout(t); } }, [toastMsg]);

  // ---- Progress events ----
  useEffect(() => {
    const un = listen<number>("op-progress", e => setProgress(e.payload));
    return () => { un.then(f => f()).catch(() => {}); };
  }, []);

    const extractPasswordRef = useRef(extractPassword);
  useEffect(() => { extractPasswordRef.current = extractPassword; }, [extractPassword]);

  const loadArchive = useCallback(async (p: string, pw?: string) => {
    const entries = await tauriListArchive(p, pw ?? (extractPasswordRef.current || undefined));
    setArchiveEntries(entries);
    setSelected(new Set());
    // 默认展开所有文件夹，方便浏览
    const dirs = new Set<string>();
    for (const e of entries) { if (e.is_dir) dirs.add(e.name.replace(/\\/g, "/").replace(/\/+$/, "")); }
    buildTree(entries).forEach(function walk(n) { if (n.isDir) { dirs.add(n.full); n.children.forEach(walk); } });
    setExpanded(dirs);
  }, []);

  // ---- 统一处理拖入的路径 ----

const handlePaths = useCallback(async (paths: string[]) => {
    if (!paths || paths.length === 0) return;
    if (paths.some(p => isArchive(p))) {
      const arch = paths.find(p => isArchive(p))!;
      setMode("extract");
      setArchivePath(arch);
      setExtractDir(dirname(arch) + "\\" + stripExt(basename(arch)));
      setExtractDone(false); setExtractError("");
      await loadArchive(arch);
      return;
    }
    const newFiles: FileEntry[] = [];
    for (const p of paths) { const info = await fileInfo(p); newFiles.push({ id: nextId(), name: basename(p), path: p, size: info?.size ?? 0 }); }
    setMode("compress");
    setFiles(prev => { const exist = new Set(prev.map(f => f.path)); return [...prev, ...newFiles.filter(f => !exist.has(f.path))]; });
  }, []);

    const handlePathsRef = useRef(handlePaths);
  useEffect(() => { handlePathsRef.current = handlePaths; }, [handlePaths]);

  // ---- 原生拖放（Tauri v2；webview 的 HTML drop 被禁用） ----
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent(ev => {
      if (ev.payload.type === "over") setDragover(true);
      else if (ev.payload.type === "leave") setDragover(false);
      else if (ev.payload.type === "drop") { setDragover(false); handlePathsRef.current(ev.payload.paths); }
    });
    return () => { un.then(f => f()).catch(() => {}); };
  }, []);

  // ---- 文件关联/命令行启动：自动打开传入的压缩包 ----
  useEffect(() => {
    (async () => { try { const p = await call("get_launch_archive") as string | null; if (p) handlePathsRef.current([p]); } catch { } })();
    const un = listen<string>("open-archive", e => { if (e.payload) handlePathsRef.current([e.payload]); });
    return () => { un.then(f => f()).catch(() => {}); };
  }, []);

  // ---- Compress helpers ----
  const addFiles = useCallback(async () => { const picked = await tauriPickFiles(); if (picked.length > 0) { setFiles(prev => { const exist = new Set(prev.map(f => f.path)); const fresh = picked.filter(f => !exist.has(f.path)); return [...prev, ...fresh.map(f => ({ id: nextId(), name: f.name, path: f.path, size: f.size }))]; }); } }, []);
  const addFolders = useCallback(async () => { const picked = await tauriPickFolders(); if (picked.length === 0) return; const allFiles: FileEntry[] = []; for (const f of picked) { try { const json = await call('list_files_in_dir', { dirPath: f.path }) as string; const children = JSON.parse(json) as { name: string; path: string; size: number; is_dir: boolean }[]; for (const c of children) { if (!c.is_dir) { allFiles.push({ id: nextId(), name: c.name, path: c.path, size: c.size }); } } } catch { allFiles.push({ id: nextId(), name: f.name + '/', path: f.path, size: f.size }); } } if (allFiles.length > 0) { setFiles(prev => { const exist = new Set(prev.map(f => f.path)); const fresh = allFiles.filter(f => !exist.has(f.path)); return [...prev, ...fresh]; }); } }, []);
  const removeFile = useCallback((id: string) => setFiles(prev => prev.filter(f => f.id !== id)), []);
  const clearAll = useCallback(() => { setFiles([]); setCompResult(null); setCompError(""); setCompDone(false); }, []);
  const pickOutputDir = useCallback(async () => { const d = await tauriPickFolder(); if (d) setOutputDir(d); }, []);

  const compressAll = useCallback(async () => {
    if (files.length === 0) return;
    const outDir = outputDir || dirname(files[0].path);
    const baseName = stripExt(files.length === 1 ? files[0].name : "archive");
    const outPath = rtrimBackslash(outDir) + "\\" + baseName + FORMAT_EXT[compFormat];
    setCompressing(true); setCompError(""); setCompDone(false); setCompResult(null); setProgress(0);
    try {
      const r = await tauriCompress(files.map(f => f.path), outPath, compFormat, compLevel, compPassword || undefined, volume || undefined);
      setCompResult(r); setCompDone(true);
      setToastMsg('压缩完成。');
    } catch (e: any) {
      setCompError(String(e));
      setToastMsg('压缩失败：' + String(e));
    } finally { setCompressing(false); setProgress(null); }
  }, [files, outputDir, compFormat, compLevel, compPassword, volume]);

  // ---- Extract helpers ----
  const openArchive = useCallback(async () => {
    const p = await tauriPickArchive(); if (!p) return;
    setArchivePath(p); setExtractDir(dirname(p) + "\\" + stripExt(basename(p))); setExtractDone(false); setExtractError("");
    await loadArchive(p);
  }, []);
  const pickExtractDir = useCallback(async () => { const d = await tauriPickFolder(); if (d) setExtractDir(d); }, []);
  const doExtract = useCallback(async () => {
    if (!archivePath || !extractDir) return;
    setExtracting(true); setExtractError(""); setExtractDone(false); setProgress(0);
    try {
      await tauriExtract(archivePath, extractDir, extractPassword || undefined);
      setExtractDone(true);
      setToastMsg('解压完成！');
    } catch (e: any) {
      setExtractError(String(e));
      setToastMsg('解压失败：' + String(e));
    } finally { setExtracting(false); setProgress(null); }
  }, [archivePath, extractDir, extractPassword]);

  const testArchive = useCallback(async () => {
    if (!archivePath) return;
    setBusyOp("test"); setProgress(0); setExtractError("");
    try { const r = await tauriTest(archivePath, extractPassword || undefined); setToastMsg(r.ok ? '✓ 完整性测试通过' : '✗ 压缩包可能已损坏'); if (!r.ok) setExtractError(r.detail || '完整性测试未通过'); }
    catch (e: any) { setExtractError(String(e)); setToastMsg('测试失败：' + String(e)); }
    finally { setBusyOp(""); setProgress(null); }
  }, [archivePath, extractPassword]);

  const addToArchive = useCallback(async () => {
    if (!archivePath) return;
    const picked = await tauriPickFiles(); if (picked.length === 0) return;
    setBusyOp("add"); setProgress(0); setExtractError("");
    try { await tauriAdd(archivePath, picked.map(f => f.path), extractPassword || undefined); await loadArchive(archivePath); setToastMsg('已追加 ' + picked.length + ' 个文件'); }
    catch (e: any) { setExtractError(String(e)); setToastMsg('追加失败：' + String(e)); }
    finally { setBusyOp(""); setProgress(null); }
  }, [archivePath, extractPassword, loadArchive]);

  const deleteSelected = useCallback(async () => {
    if (!archivePath || selected.size === 0) return;
    setBusyOp("delete"); setProgress(0); setExtractError("");
    try { await tauriDelete(archivePath, Array.from(selected), extractPassword || undefined); await loadArchive(archivePath); setToastMsg('已删除 ' + selected.size + ' 项'); }
    catch (e: any) { setExtractError(String(e)); setToastMsg('删除失败：' + String(e)); }
    finally { setBusyOp(""); setProgress(null); }
  }, [archivePath, selected, extractPassword, loadArchive]);

  const openEntry = useCallback(async (n: TreeNode) => {
    if (n.isDir) return;
    try { await tauriOpenEntry(archivePath, n.full, extractPassword || undefined); setToastMsg('正在打开 ' + n.name); }
    catch (e: any) { setToastMsg('打开失败：' + String(e)); }
  }, [archivePath, extractPassword]);

  // ---- Tree interactions ----
  const toggleExpand = useCallback((full: string) => setExpanded(prev => { const s = new Set(prev); if (s.has(full)) s.delete(full); else s.add(full); return s; }), []);
  const toggleSelect = useCallback((node: TreeNode) => setSelected(prev => {
    const files: string[] = []; collectFiles(node, files);
    const s = new Set(prev);
    const allOn = files.length > 0 && files.every(f => s.has(f));
    for (const f of files) { if (allOn) s.delete(f); else s.add(f); }
    return s;
  }), []);

  // ---- Context menu for files ----
  const onFileCtx = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, items: [
      { label: '移除', onClick: () => removeFile(entry.id) },
      { label: '在文件管理器中显示', onClick: () => tauriReveal(entry.path) },
    ]});
  }, [removeFile]);

  // ---- Derived ----
  const totalSize = files.reduce((s, f) => s + f.size, 0);
  const ratio = compResult && totalSize > 0 ? ((1 - compResult.size / totalSize) * 100).toFixed(0) : null;
  const archTotalSize = archiveEntries.reduce((s, e) => s + e.size, 0);
  const archTotalCompressed = archiveEntries.reduce((s, e) => s + e.compressed_size, 0);
  const tree = useMemo(() => buildTree(archiveEntries), [archiveEntries]);
  const busy = compressing || extracting || busyOp !== "";

  return (
    <div className="app-shell">
      {/* Toast */}
      {toastMsg && <div className="toast">{toastMsg}</div>}
      {/* Titlebar */}
      <div className="titlebar">
        <div className="titlebar-left">
          <svg className="logo-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          <span className="logo"><span>ui</span>Zip</span>
        </div>
        <div className="titlebar-right">
          <button className="settings-btn" onClick={toggleDark} title={theme.isDark ? '浅色模式' : '深色模式'}>
            {theme.isDark
              ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
              : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>}
          </button>
          <button className="settings-btn" onClick={() => setSettingsOpen(true)} title={'设置'}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg></button>
        </div>
      </div>
      {/* Tabs */}
      <div className="mode-tabs">
        <button className={"mode-tab " + (mode === "compress" ? "active" : "")} onClick={() => setMode("compress")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
          {'压缩'}
        </button>
        <button className={"mode-tab " + (mode === "extract" ? "active" : "")} onClick={() => setMode("extract")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          {'解压'}
        </button>
      </div>
      {/* Content */}
      <main className="main-content">
        {mode === "compress" && (<div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 12, overflow: "hidden" }}>
          {/* Settings bar */}
          <div className="settings-bar">
            <div className="settings-row">
              <label className="sbar-label">{'格式'}</label>
              <select className="sbar-select" value={compFormat} onChange={e => setCompFormat(e.target.value as ArchiveFormat)}>
                {(Object.keys(FORMAT_LABELS) as ArchiveFormat[]).map(f => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
              </select>
            </div>
            <div className="settings-row">
              <label className="sbar-label">{'级别'}</label>
              <div className="sbar-levels">
                {LEVELS.map(l => (
                  <button key={l.value} className={"sbar-lvl " + (compLevel === l.value ? "active" : "")} onClick={() => setCompLevel(l.value)} title={l.hint}>{l.label}</button>
                ))}
              </div>
            </div>
            <div className="settings-row">
              <label className="sbar-label">{'密码'}</label>
              <div className="sbar-pw">
                <input className="sbar-input" type={showCompPassword ? "text" : "password"} value={compPassword} onChange={e => setCompPassword(e.target.value)} placeholder={'可选'} style={{width: 110}} />
                <button className="sbar-icon" onClick={() => setShowCompPassword(v => !v)} title={'显示'}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {showCompPassword ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></> : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>}
                  </svg>
                </button>
              </div>
            </div>
            <div className="settings-row">
              <label className="sbar-label">{'分卷'}</label>
              <input className="sbar-input" value={volume} onChange={e => setVolume(e.target.value)} placeholder={'如 100M'} style={{width: 90}} />
            </div>
            <div className="settings-row sbar-grow">
              <label className="sbar-label">{'保存到'}</label>
              <div className="sbar-path">
                <input className="sbar-input sbar-flex" value={outputDir} readOnly onClick={pickOutputDir} placeholder={'点击选择目录...'} />
                <button className="sbar-icon" onClick={pickOutputDir} title={'浏览'}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                </button>
              </div>
            </div>
          </div>
          {/* Dropzone / file list */}
          <div className={"dropzone " + (dragover ? "dragover" : "") + (files.length === 0 ? " empty" : "")}>
            {files.length === 0 ? (<div className="dropzone-hint">
              <svg className="dropzone-icon-svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <p>{'拖拽文件到此处'}</p>
              <p className="sub">{'或点击下方“添加文件”或“添加文件夹”'}</p>
            </div>) : (<div className="file-list">
              <div className="file-list-header"><span className="col-name">{'文件名'}</span><span className="col-size">{'大小'}</span><span className="col-action"></span></div>
              {files.map(f => (<div key={f.id} className="file-row" onContextMenu={e => onFileCtx(e, f)}><span className="col-name"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>{f.name}</span><span className="col-size">{fmtSize(f.size)}</span><span className="col-action"><button className="remove-btn" onClick={() => removeFile(f.id)}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></span></div>))}
            </div>)}
          </div>
          {/* Action bar */}
          <footer className="action-bar">
            {compressing ? <ProgressBar value={progress ?? 0} label={'压缩中'} /> : (<>
              <div className="action-info">
                <span>{files.length} {'个文件 · '}{fmtSize(totalSize)}</span>
                {ratio && <span className="ratio">{' · 减小 '}{ratio}%</span>}
                {compError && <span className="error-msg">{compError}</span>}
              </div>
              <div className="action-buttons">
                <button className="btn btn-outline" onClick={addFiles}>{'添加文件'}</button>
                <button className="btn btn-outline" onClick={addFolders}>{'添加文件夹'}</button>
                {files.length > 0 && <button className="btn btn-outline" onClick={clearAll}>{'清空'}</button>}
                {files.length > 0 && <button className="btn btn-primary" onClick={compressAll} disabled={compressing}>{compressing ? '压缩中...' : compDone ? '完成' : '开始压缩'}</button>}
              </div>
            </>)}
          </footer>
        </div>)}
        {mode === "extract" && (<div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 12, overflow: "hidden" }}>
          <div className="extract-panel" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, overflow: "hidden" }}>
            {/* Open + toolbar */}
            <div className="extract-pick-area" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={openArchive}>{'打开压缩包'}</button>
              {archivePath && <span className="archive-path-label">{basename(archivePath)}</span>}
              {archiveEntries.length > 0 && (<div className="arch-toolbar">
                <button className="btn btn-outline btn-sm" onClick={testArchive} disabled={busy}>{'完整性测试'}</button>
                <button className="btn btn-outline btn-sm" onClick={addToArchive} disabled={busy}>{'追加文件'}</button>
                <button className="btn btn-outline btn-sm" onClick={deleteSelected} disabled={busy || selected.size === 0}>{'删除所选'}{selected.size > 0 ? ' (' + selected.size + ')' : ''}</button>
              </div>)}
            </div>
            {/* Archive tree */}
            {archiveEntries.length > 0 && (<>
              <div className="archive-stats">
                <span>{archiveEntries.length} {'个条目'}</span>
                <span>{' · 原始 '}{fmtSize(archTotalSize)}</span>
                <span className="ratio">{' · 压缩 '}{fmtSize(archTotalCompressed)}</span>
              </div>
              <div className="file-list tree-list" style={{ flex: 1, overflow: "auto" }}>
                <div className="file-list-header tree-header"><span className="tree-h-name">{'名称'}</span><span className="tree-h-size">{'大小'}</span><span className="tree-h-comp">{'压缩后'}</span><span className="tree-h-act" /></div>
                <TreeRows nodes={tree} depth={0} expanded={expanded} toggleExpand={toggleExpand} selected={selected} toggleSelect={toggleSelect} onOpen={openEntry} />
              </div>
            </>)}
            {/* Extract controls */}
            {archivePath && (<div className="extract-bar">
              {busy ? <ProgressBar value={progress ?? 0} label={busyOp === "test" ? '测试中' : busyOp === "add" ? '追加中' : busyOp === "delete" ? '删除中' : '解压中'} /> : (<>
                <div className="extract-options">
                  <div className="ext-input-row">
                    <span className="ext-label">{'解压到:'}</span>
                    <input className="ext-input" value={extractDir} onChange={e => setExtractDir(e.target.value)} />
                    <button className="btn btn-sm" onClick={pickExtractDir}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg></button>
                  </div>
                  <div className="ext-pw-row">
                    <span className="ext-label">{'密码:'}</span>
                    <input className="ext-input" type={showExtractPassword ? "text" : "password"} value={extractPassword} onChange={e => setExtractPassword(e.target.value)} placeholder={'可选'} style={{ width: 140, flex: "none" }} />
                    <button className="btn btn-sm icon-only" onClick={() => setShowExtractPassword(v => !v)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{showExtractPassword ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></> : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>}</svg></button>
                  </div>
                </div>
                <div className="action-buttons" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                  <button className="btn btn-primary" onClick={doExtract} disabled={busy || !extractDir}>{extracting ? '解压中...' : extractDone ? '完成' : '解压全部'}</button>
                  {extractDone && <button className="btn btn-outline btn-sm" onClick={() => tauriReveal(extractDir)}>{'打开目录'}</button>}
                  {extractError && <span className="error-msg">{extractError}</span>}
                </div>
              </>)}
            </div>)}
            {/* Empty state for extract */}
            {!archivePath && archiveEntries.length === 0 && (<div className={"dropzone empty" + (dragover ? " dragover" : "")} style={{ flex: 1 }}>
              <div className="dropzone-hint">
                <svg className="dropzone-icon-svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                <p>{'拖拽压缩包到此处'}</p>
                <p className="sub">{'或点击上方“打开压缩包”'}</p>
              </div>
            </div>)}
          </div>
        </div>)}
      </main>
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)} items={ctxMenu.items} />}
    </div>
  );
}
