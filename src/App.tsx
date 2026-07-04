import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "./theme";
import { themeList, type ThemeId } from "./theme";
import "./App.css";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";

// ---- Types ----
type Mode = "compress" | "extract";
type CompLevel = 0 | 1 | 2 | 3 | 5 | 7 | 9;
type ArchiveFormat = "zip" | "7z" | "tar" | "gz" | "bz2" | "xz" | "lzma" | "zst" | "iso" | "cab" | "arj" | "lzh" | "wim";
interface FileEntry { id: string; name: string; path: string; size: number; }
interface ArchiveEntry { name: string; size: number; compressed_size: number; is_dir: boolean; }

const LEVEL_LABELS: Record<CompLevel, string> = { 0: "\u4ec5\u5b58\u50a8", 1: "\u6700\u5feb", 2: "\u5feb\u901f", 3: "\u5feb\u901f", 5: "\u6807\u51c6", 7: "\u6700\u4f18", 9: "\u6781\u9650" };
const FORMAT_LABELS: Record<ArchiveFormat, string> = { "7z": "7z (高压缩)", zip: "ZIP (通用)", tar: "TAR (归档)", gz: "GZip (.gz)", bz2: "BZip2 (.bz2)", xz: "XZ (.xz)", lzma: "LZMA", zst: "Zstd", iso: "ISO (光盘镜像)", cab: "CAB (微软)", arj: "ARJ", lzh: "LZH", wim: "WIM (映像)" };
const FORMAT_EXT: Record<ArchiveFormat, string> = { zip: ".zip", "7z": ".7z", tar: ".tar", gz: ".gz", bz2: ".bz2", xz: ".xz", lzma: ".lzma", zst: ".zst", iso: ".iso", cab: ".cab", arj: ".arj", lzh: ".lzh", wim: ".wim" };
const ARCHIVE_EXTS = [".zip", ".7z", ".rar", ".tar", ".gz", ".bz2", ".xz", ".iso", ".cab", ".arj", ".lzh", ".zst", ".lzma", ".wim", ".cpio", ".lha", ".tgz", ".tbz2", ".txz", ".tzst", ".001", ".r00"];

function fmtSize(bytes: number): string { if (bytes < 1024) return bytes + " B"; if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB"; if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB"; return (bytes / 1073741824).toFixed(2) + " GB"; }
function basename(p: string): string { const s = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/")); return s === -1 ? p : p.slice(s + 1); }
function dirname(p: string): string { const s = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/")); return s === -1 ? "" : p.slice(0, s); }
function stripExt(p: string): string { const d = p.lastIndexOf("."); if (d === -1) return p; const s = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/")); return d > s ? p.slice(0, d) : p; }
function extname(p: string): string { const d = p.lastIndexOf("."); if (d === -1) return ""; const s = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/")); return d > s ? p.slice(d).toLowerCase() : ""; }
function rtrimBackslash(s: string): string { let i = s.length; while (i > 0 && (s.charCodeAt(i - 1) === 92 || s.charCodeAt(i - 1) === 47)) i--; return s.slice(0, i); }
function isArchive(f: string): boolean { const e = extname(f); return ARCHIVE_EXTS.includes(e); }
let uid = 0; const nextId = () => "f" + (++uid);

// ---- Tauri bridge ----
async function call(cmd: string, args?: Record<string, unknown>): Promise<unknown> { return tauriInvoke(cmd, args ?? {}); }
async function tauriPickFiles(): Promise<{ name: string; path: string; size: number }[]> { try { const selected = await dialogOpen({ multiple: true, filters: [{ name: '所有文件', extensions: ['*'] }] }); if (!selected) return []; const paths = Array.isArray(selected) ? selected : [selected]; const r: { name: string; path: string; size: number }[] = []; for (const p of paths) { try { const info = JSON.parse((await call("get_file_info", { path: p })) as string) as { size: number; is_dir: boolean }; r.push({ name: basename(p), path: p, size: info.size }); } catch { } } return r; } catch { return []; } }
async function tauriPickFolders(): Promise<{ name: string; path: string; size: number }[]> { try { const selected = await dialogOpen({ multiple: true, directory: true, title: '选择文件夹' }); if (!selected) return []; const paths = Array.isArray(selected) ? selected : [selected]; const r: { name: string; path: string; size: number }[] = []; for (const p of paths) { try { const info = JSON.parse((await call("get_file_info", { path: p })) as string) as { size: number; is_dir: boolean }; r.push({ name: basename(p), path: p, size: info.size }); } catch { } } return r; } catch { return []; } }
async function tauriPickArchive(): Promise<string> { try { const selected = await dialogOpen({ multiple: false, filters: [{ name: '所有压缩包', extensions: ['zip','7z','rar','tar','gz','bz2','xz','iso','cab','arj','lzh','zst','lzma','wim','cpio','lha','z','txz','tgz','tbz2','tzst','001','r00'] }] }); return selected ? (Array.isArray(selected) ? selected[0] : selected) : ''; } catch { return ''; } }
async function tauriListArchive(path: string, pw?: string): Promise<ArchiveEntry[]> { try { return (await call("list_archive", { path, password: pw ?? "" })) as ArchiveEntry[]; } catch { return []; } }
async function tauriExtract(archivePath: string, outputDir: string, password?: string): Promise<{ path: string }> { const r = (await call("extract_archive", { archivePath, outputDir, password: password ?? "" })) as string; return JSON.parse(r); }
async function tauriPickFolder(): Promise<string> { try { const selected = await dialogOpen({ multiple: false, directory: true, title: '选择目录' }); return selected ? (Array.isArray(selected) ? selected[0] : selected) : ''; } catch { return ''; } }
async function tauriCompress(inputPaths: string[], outputPath: string, format: ArchiveFormat, level: CompLevel, password?: string, volume?: string): Promise<{ path: string; size: number }> { const r = (await call("compress_files", { inputPaths, outputPath, format, level, password: password ?? "", volume: volume ?? "" })) as string; return JSON.parse(r); }

// ---- Settings Panel ----
function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme, setThemeId } = useTheme(); if (!open) return null;
  return (<div className="settings-overlay" onClick={onClose}><div className="settings-panel" onClick={e => e.stopPropagation()}>
    <div className="settings-header"><h2>{'\u8bbe\u7f6e'}</h2><button className="close-btn" onClick={onClose}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button></div>
    <section className="settings-section"><h3>{'\u4e3b\u9898'}</h3><div className="theme-grid">{themeList.map(t => (<button key={t.id} className={"theme-card " + (theme.id === t.id ? "active" : "")} onClick={() => setThemeId(t.id as ThemeId)} data-theme-card={t.id}><div className="theme-preview" data-theme-preview={t.id}><span className="preview-dot" /><span className="preview-bar" /></div><span className="theme-label">{t.label}</span></button>))}</div></section>
    <section className="settings-section"><h3>{'\u5173\u4e8e'}</h3><p className="about-text">uiZip \u2014 \u7cbe\u7f8e\u7684 Windows \u538b\u7f29\u5de5\u5177\u3002\u57fa\u4e8e Tauri + React\uff0c\u5185\u7f6e 7-Zip \u5f15\u64ce\u3002</p></section>
  </div></div>);
}

// ---- Context Menu ----
function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: { label: string; onClick: () => void }[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, [onClose]);
  const pos = { left: Math.min(x, window.innerWidth - 180), top: Math.min(y, window.innerHeight - items.length * 36 - 8) };
  return (<div ref={ref} className="context-menu" style={pos}>{items.map((it, i) => (<button key={i} className="ctx-item" onClick={() => { it.onClick(); onClose(); }}>{it.label}</button>))}</div>);
}

// ---- Main App ----
export default function App() {
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

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: { label: string; onClick: () => void }[] } | null>(null);
  const [dragover, setDragover] = useState(false);
  const [toastMsg, setToastMsg] = useState("");

  useEffect(() => { if (toastMsg) { const t = setTimeout(() => setToastMsg(""), 3000); return () => clearTimeout(t); } }, [toastMsg]);

  // ---- Compress helpers ----
  const addFiles = useCallback(async () => { const picked = await tauriPickFiles(); if (picked.length > 0) { setFiles(prev => { const exist = new Set(prev.map(f => f.path)); const fresh = picked.filter(f => !exist.has(f.path)); return [...prev, ...fresh.map(f => ({ id: nextId(), name: f.name, path: f.path, size: f.size }))]; }); } }, []);
  const addFolders = useCallback(async () => { const picked = await tauriPickFolders(); if (picked.length > 0) { setFiles(prev => { const exist = new Set(prev.map(f => f.path)); const fresh = picked.filter(f => !exist.has(f.path)); return [...prev, ...fresh.map(f => ({ id: nextId(), name: f.name + '/', path: f.path, size: f.size }))]; }); } }, []);
  const removeFile = useCallback((id: string) => setFiles(prev => prev.filter(f => f.id !== id)), []);
  const openInExplorer = useCallback((p: string) => { call("get_file_info", { path: dirname(p) }).catch(() => { }); }, []);
  const clearAll = useCallback(() => { setFiles([]); setCompResult(null); setCompError(""); setCompDone(false); }, []);
  const pickOutputDir = useCallback(async () => { const d = await tauriPickFolder(); if (d) setOutputDir(d); }, []);

  const compressAll = useCallback(async () => {
    if (files.length === 0) return;
    const outDir = outputDir || dirname(files[0].path);
    const baseName = stripExt(files.length === 1 ? files[0].name : "archive");
    const outPath = rtrimBackslash(outDir) + "\\" + baseName + FORMAT_EXT[compFormat];
    setCompressing(true); setCompError(""); setCompDone(false); setCompResult(null);
    try {
      const r = await tauriCompress(files.map(f => f.path), outPath, compFormat, compLevel, compPassword || undefined, volume || undefined);
      setCompResult(r); setCompDone(true); setCompressing(false);
      setToastMsg('\u538b\u7f29\u5b8c\u6210\u3002');
    } catch (e: any) {
      setCompError(String(e)); setCompressing(false);
      setToastMsg('\u538b\u7f29\u5931\u8d25\uff1a' + String(e));
    }
  }, [files, outputDir, compFormat, compLevel, compPassword, volume]);

  // ---- Extract helpers ----
  const openArchive = useCallback(async () => {
    const p = await tauriPickArchive(); if (!p) return;
    setArchivePath(p); setExtractDir(dirname(p) + "\\" + stripExt(basename(p))); setExtractDone(false); setExtractError("");
    const entries = await tauriListArchive(p, extractPassword || undefined);
    setArchiveEntries(entries);
  }, [extractPassword]);
  const pickExtractDir = useCallback(async () => { const d = await tauriPickFolder(); if (d) setExtractDir(d); }, []);
  const doExtract = useCallback(async () => {
    if (!archivePath || !extractDir) return;
    setExtracting(true); setExtractError(""); setExtractDone(false);
    try {
      await tauriExtract(archivePath, extractDir, extractPassword || undefined);
      setExtractDone(true); setExtracting(false);
      setToastMsg('\u89e3\u538b\u5b8c\u6210\uff01');
    } catch (e: any) {
      setExtractError(String(e)); setExtracting(false);
      setToastMsg('\u89e3\u538b\u5931\u8d25\uff1a' + String(e));
    }
  }, [archivePath, extractDir, extractPassword]);

  // ---- Drag & Drop ----
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault(); setDragover(false);
    const items = Array.from(e.dataTransfer.files); if (items.length === 0) return;
    const paths = items.map(f => (f as any).path as string).filter(Boolean);
    // Check if any dropped file is an archive => switch to extract mode
    if (paths.some(p => isArchive(p))) {
      const arch = paths.find(p => isArchive(p))!;
      setMode("extract");
      setArchivePath(arch);
      setExtractDir(dirname(arch) + "\\" + stripExt(basename(arch)));
      setExtractDone(false); setExtractError("");
      const entries = await tauriListArchive(arch);
      setArchiveEntries(entries);
      return;
    }
    // Otherwise add as compress files
    const newFiles: FileEntry[] = [];
    for (const p of paths) { try { const info = JSON.parse((await call("get_file_info", { path: p })) as string) as { size: number; is_dir: boolean }; newFiles.push({ id: nextId(), name: basename(p), path: p, size: info.size }); } catch { } }
    setFiles(prev => { const exist = new Set(prev.map(f => f.path)); return [...prev, ...newFiles.filter(f => !exist.has(f.path))]; });
  }, []);

  // ---- Context menu for files ----
  const onFileCtx = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, items: [
      { label: '\u79fb\u9664', onClick: () => removeFile(entry.id) },
      { label: '\u5728\u6587\u4ef6\u7ba1\u7406\u5668\u4e2d\u67e5\u770b', onClick: () => openInExplorer(entry.path) },
    ]});
  }, [removeFile, openInExplorer]);

  // ---- Derived ----
  const totalSize = files.reduce((s, f) => s + f.size, 0);
  const ratio = compResult && totalSize > 0 ? ((1 - compResult.size / totalSize) * 100).toFixed(0) : null;
  const archTotalSize = archiveEntries.reduce((s, e) => s + e.size, 0);
  const archTotalCompressed = archiveEntries.reduce((s, e) => s + e.compressed_size, 0);

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
          <button className="settings-btn" onClick={() => setSettingsOpen(true)} title={'\u8bbe\u7f6e'}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg></button>
        </div>
      </div>
      {/* Tabs */}
      <div className="mode-tabs">
        <button className={"mode-tab " + (mode === "compress" ? "active" : "")} onClick={() => setMode("compress")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
          {'\u538b\u7f29'}
        </button>
        <button className={"mode-tab " + (mode === "extract" ? "active" : "")} onClick={() => setMode("extract")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          {'\u89e3\u538b'}
        </button>
      </div>
      {/* Content */}
      <main className="main-content">
        {mode === "compress" && (<div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 12, overflow: "hidden" }}>
          {/* Settings bar */}
          <div className="settings-bar">
            <div className="settings-row">
              <label className="sbar-label">{'\u683c\u5f0f'}</label>
              <select className="sbar-select" value={compFormat} onChange={e => setCompFormat(e.target.value as ArchiveFormat)}>
                {(Object.keys(FORMAT_LABELS) as ArchiveFormat[]).map(f => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
              </select>
            </div>
            <div className="settings-row">
              <label className="sbar-label">{'\u7ea7\u522b'}</label>
              <div className="sbar-levels">
                {(Object.keys(LEVEL_LABELS).map(Number) as CompLevel[]).map(l => (
                  <button key={l} className={"sbar-lvl " + (compLevel === l ? "active" : "")} onClick={() => setCompLevel(l)}>{LEVEL_LABELS[l]}</button>
                ))}
              </div>
            </div>
            <div className="settings-row">
              <label className="sbar-label">{'\u5bc6\u7801'}</label>
              <div className="sbar-pw">
                <input className="sbar-input" type={showCompPassword ? "text" : "password"} value={compPassword} onChange={e => setCompPassword(e.target.value)} placeholder={'\u53ef\u9009'} style={{width: 110}} />
                <button className="sbar-icon" onClick={() => setShowCompPassword(v => !v)} title={'\u663e\u793a'}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {showCompPassword ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></> : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>}
                  </svg>
                </button>
              </div>
            </div>
            <div className="settings-row">
              <label className="sbar-label">{'\u5206\u5377'}</label>
              <input className="sbar-input" value={volume} onChange={e => setVolume(e.target.value)} placeholder={'\u5982 100M'} style={{width: 90}} />
            </div>
            <div className="settings-row sbar-grow">
              <label className="sbar-label">{'\u4fdd\u5b58\u5230'}</label>
              <div className="sbar-path">
                <input className="sbar-input sbar-flex" value={outputDir} readOnly onClick={pickOutputDir} placeholder={'\u70b9\u51fb\u9009\u62e9\u76ee\u5f55...'} />
                <button className="sbar-icon" onClick={pickOutputDir} title={'\u6d4f\u89c8'}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                </button>
              </div>
            </div>
          </div>
          {/* Dropzone / file list */}
          <div className={"dropzone " + (dragover ? "dragover" : "") + (files.length === 0 ? " empty" : "")}
            onDragOver={e => { e.preventDefault(); setDragover(true); }} onDragLeave={() => setDragover(false)} onDrop={handleDrop}>
            {files.length === 0 ? (<div className="dropzone-hint">
              <svg className="dropzone-icon-svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <p>{'\u62d6\u62fd\u6587\u4ef6\u5230\u6b64\u5904'}</p>
              <p className="sub">{'\u6216\u70b9\u51fb\u4e0b\u65b9\u201c\u6dfb\u52a0\u6587\u4ef6\u201d\u6216\u201c\u6dfb\u52a0\u6587\u4ef6\u5939\u201d'}</p>
            </div>) : (<div className="file-list">
              <div className="file-list-header"><span className="col-name">{'\u6587\u4ef6\u540d'}</span><span className="col-size">{'\u5927\u5c0f'}</span><span className="col-action"></span></div>
              {files.map(f => (<div key={f.id} className="file-row" onContextMenu={e => onFileCtx(e, f)}><span className="col-name"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>{f.name}</span><span className="col-size">{fmtSize(f.size)}</span><span className="col-action"><button className="remove-btn" onClick={() => removeFile(f.id)}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></span></div>))}
            </div>)}
          </div>
          {/* Action bar */}
          <footer className="action-bar">
            <div className="action-info">
              <span>{files.length} {'\u4e2a\u6587\u4ef6 \u00b7 '}{fmtSize(totalSize)}</span>
              {ratio && <span className="ratio">{' \u00b7 \u51cf\u5c0f '}{ratio}%</span>}
              {compError && <span className="error-msg">{compError}</span>}
            </div>
            <div className="action-buttons">
              <button className="btn btn-outline" onClick={addFiles}>{'\u6dfb\u52a0\u6587\u4ef6'}</button>
              <button className="btn btn-outline" onClick={addFolders}>{'\u6dfb\u52a0\u6587\u4ef6\u5939'}</button>
              {files.length > 0 && <button className="btn btn-outline" onClick={clearAll}>{'\u6e05\u7a7a'}</button>}
              {files.length > 0 && <button className="btn btn-primary" onClick={compressAll} disabled={compressing}>{compressing ? '\u538b\u7f29\u4e2d...' : compDone ? '\u5b8c\u6210' : '\u5f00\u59cb\u538b\u7f29'}</button>}
            </div>
          </footer>
        </div>)}
        {mode === "extract" && (<div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 12, overflow: "hidden" }}>
          <div className="extract-panel" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, overflow: "hidden" }}>
            {/* Open */}
            <div className="extract-pick-area" style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button className="btn btn-primary" onClick={openArchive}>{'\u6253\u5f00\u538b\u7f29\u5305'}</button>
              {archivePath && <span className="archive-path-label">{basename(archivePath)}</span>}
            </div>
            {/* Archive entries */}
            {archiveEntries.length > 0 && (<>
              <div className="archive-stats">
                <span>{archiveEntries.length} {'\u4e2a\u6761\u76ee'}</span>
                <span>{' \u00b7 \u539f\u59cb '}{fmtSize(archTotalSize)}</span>
                <span className="ratio">{' \u00b7 \u538b\u7f29 '}{fmtSize(archTotalCompressed)}</span>
              </div>
              <div className="file-list" style={{ flex: 1, overflow: "auto" }}>
                <div className="file-list-header"><span className="col-name">{'\u6587\u4ef6\u540d'}</span><span className="col-size">{'\u5927\u5c0f'}</span><span className="col-compressed">{'\u538b\u7f29\u540e'}</span></div>
                {archiveEntries.map((e, i) => (<div key={i} className="file-row"><span className="col-name">{e.is_dir && <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="folder-icon"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg> </>}{e.name}</span><span className="col-size">{e.is_dir ? "" : fmtSize(e.size)}</span><span className="col-compressed">{e.is_dir ? "" : fmtSize(e.compressed_size)}</span></div>))}
              </div>
            </>)}
            {/* Extract controls */}
            {archivePath && (<div className="extract-bar">
              <div className="extract-options">
                <div className="ext-input-row">
                  <span className="ext-label">{'\u89e3\u538b\u5230:'}</span>
                  <input className="ext-input" value={extractDir} onChange={e => setExtractDir(e.target.value)} />
                  <button className="btn btn-sm" onClick={pickExtractDir}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg></button>
                </div>
                <div className="ext-pw-row">
                  <span className="ext-label">{'\u5bc6\u7801:'}</span>
                  <input className="output-input pw-input" type={showExtractPassword ? "text" : "password"} value={extractPassword} onChange={e => setExtractPassword(e.target.value)} placeholder={'\u53ef\u9009'} />
                  <button className="btn btn-sm icon-only" onClick={() => setShowExtractPassword(v => !v)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{showExtractPassword ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></> : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>}</svg></button>
                </div>
              </div>
              <div className="action-buttons" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <button className="btn btn-primary" onClick={doExtract} disabled={extracting || !extractDir}>{extracting ? '\u89e3\u538b\u4e2d...' : extractDone ? '\u5b8c\u6210' : '\u89e3\u538b'}</button>
                {extractDone && <span className="ratio">{'\u89e3\u538b\u5b8c\u6210'}</span>}
                {extractError && <span className="error-msg">{extractError}</span>}
              </div>
            </div>)}
            {/* Empty state for extract */}
            {!archivePath && archiveEntries.length === 0 && (<div className="dropzone empty" style={{ flex: 1 }}
              onDragOver={e => { e.preventDefault(); setDragover(true); }} onDragLeave={() => setDragover(false)} onDrop={handleDrop}>
              <div className="dropzone-hint">
                <svg className="dropzone-icon-svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                <p>{'\u62d6\u62fd\u538b\u7f29\u5305\u5230\u6b64\u5904'}</p>
                <p className="sub">{'\u6216\u70b9\u51fb\u4e0a\u65b9\u201c\u6253\u5f00\u538b\u7f29\u5305\u201d'}</p>
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
