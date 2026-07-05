use serde::{Deserialize, Serialize};
use std::io::Read;
use std::process::{Command, Stdio};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::async_runtime::spawn_blocking;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

fn find_7z() -> PathBuf {
    // Always look next to our exe (dev: target/debug, bundle: install dir)
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    let bundled = exe_dir.join("7z.exe");
    if bundled.exists() {
        return bundled;
    }
    // Fallback to PATH
    PathBuf::from("7z.exe")
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ArchiveEntry {
    pub name: String,
    pub size: u64,
    pub compressed_size: u64,
    pub is_dir: bool,
}

// 启动时通过文件关联/命令行传入的压缩包路径（取一次即清空）
struct LaunchArchive(Mutex<Option<String>>);

#[cfg(windows)]
fn command(exe: &PathBuf) -> Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut c = Command::new(exe);
    c.creation_flags(CREATE_NO_WINDOW); // 不弹出 7z 控制台黑窗
    c
}
#[cfg(not(windows))]
fn command(exe: &PathBuf) -> Command {
    Command::new(exe)
}

fn run_7z(args: &[&str]) -> Result<String, String> {
    let exe = find_7z();
    let output = command(&exe)
        .args(args)
        .output()
        .map_err(|e| format!("7z 启动失败: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        let msg = if stderr.trim().is_empty() { stdout.trim().to_string() } else { stderr.trim().to_string() };
        return Err(if msg.is_empty() { format!("7z 异常退出，代码: {}", output.status.code().unwrap_or(-1)) } else { msg });
    }
    Ok(stdout)
}

// 从形如 " 42% 12 - name" 的进度行里取出百分比。
// ponytail: 简单启发式——找第一个 '%' 再向左收数字。7z 用 \r 覆盖进度行，
// 非进度输出不含 "N%" 前缀，因此误报极少；若 7z 输出格式变化最多是进度不动，不影响结果正确性。
fn parse_percent(s: &str) -> Option<u32> {
    let bytes = s.as_bytes();
    let pos = bytes.iter().position(|&b| b == b'%')?;
    let mut start = pos;
    while start > 0 && bytes[start - 1].is_ascii_digit() {
        start -= 1;
    }
    if start == pos {
        return None;
    }
    s[start..pos].parse::<u32>().ok().filter(|&p| p <= 100)
}

// 流式运行 7z：解析 stdout 中的进度并通过 `op-progress` 事件推送 0-100。
// 由 spawn_blocking 在后台线程调用，绝不阻塞主线程/UI。
fn run_7z_streaming(window: &tauri::Window, args: &[String]) -> Result<String, String> {
    let exe = find_7z();
    let mut child = command(&exe)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("7z 启动失败: {}", e))?;

    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();

    // stderr 在独立线程收集，避免管道写满造成死锁
    let err_handle = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });

    let _ = window.emit("op-progress", 0u32);
    let mut buf = [0u8; 4096];
    let mut line: Vec<u8> = Vec::new();
    let mut full = String::new();
    let mut last_pct: i32 = -1;
    loop {
        let n = match stdout.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => break,
        };
        for &b in &buf[..n] {
            if b == b'\r' || b == b'\n' || b == 0x08 {
                if !line.is_empty() {
                    let text = String::from_utf8_lossy(&line).to_string();
                    match parse_percent(&text) {
                        Some(p) if p as i32 != last_pct => {
                            last_pct = p as i32;
                            let _ = window.emit("op-progress", p);
                        }
                        Some(_) => {}
                        None => {
                            full.push_str(&text);
                            full.push('\n');
                        }
                    }
                    line.clear();
                }
            } else {
                line.push(b);
            }
        }
    }
    if !line.is_empty() {
        full.push_str(&String::from_utf8_lossy(&line));
    }

    let status = child.wait().map_err(|e| format!("等待 7z 结束失败: {}", e))?;
    let err = err_handle.join().unwrap_or_default();
    let _ = window.emit("op-progress", 100u32);

    if !status.success() {
        let msg = if !err.trim().is_empty() { err.trim().to_string() } else { full.trim().to_string() };
        return Err(if msg.is_empty() { format!("7z 异常退出，代码: {}", status.code().unwrap_or(-1)) } else { msg });
    }
    Ok(full)
}

fn format_switch(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "7z" => "7z",
        "zip" => "zip",
        "tar" => "tar",
        "gz" | "gzip" => "gzip",
        "bz2" | "bzip2" => "bzip2",
        "xz" => "xz",
        "lzma" => "lzma",
        "lzma2" => "lzma2",
        "zst" | "zstd" => "zstd",
        "rar" => "rar",
        "iso" => "iso",
        "cab" => "cab",
        "arj" => "arj",
        "lzh" | "lha" => "lzh",
        "wim" => "wim",
        "cpio" => "cpio",
        _ => "zip",
    }
}

// ---- 同步实现（在后台线程运行） ----

fn list_archive_impl(path: String, password: Option<String>) -> Result<Vec<ArchiveEntry>, String> {
    let mut args: Vec<String> = vec!["l".into(), "-slt".into(), path.clone()];
    if let Some(ref pw) = password {
        if !pw.is_empty() {
            args.push(format!("-p{}", pw));
        }
    }
    let str_args: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = run_7z(&str_args)?;

    let mut entries = Vec::new();
    let mut current_name = String::new();
    let mut current_size: u64 = 0;
    let mut current_compressed: u64 = 0;
    let mut current_attr = String::new();

    for line in output.lines() {
        if line.starts_with("Path = ") {
            current_name = line[7..].to_string();
        } else if line.starts_with("Size = ") {
            current_size = line[7..].trim().trim_start_matches('+').parse().unwrap_or(0);
        } else if line.starts_with("Packed Size = ") {
            current_compressed = line[14..].trim().trim_start_matches('+').parse().unwrap_or(0);
        } else if line.starts_with("Attributes = ") {
            current_attr = line[13..].trim().to_string();
        }
        if !current_name.is_empty() && (line.is_empty() || line.starts_with("----------")) {
            let is_dir = current_name.ends_with('/') || current_name.ends_with('\\') || current_attr.starts_with('D');
            entries.push(ArchiveEntry { name: current_name.clone(), size: current_size, compressed_size: current_compressed, is_dir });
            current_name.clear();
            current_size = 0;
            current_compressed = 0;
            current_attr.clear();
        }
    }
    if !current_name.is_empty() {
        let is_dir = current_name.ends_with('/') || current_name.ends_with('\\') || current_attr.starts_with('D');
        entries.push(ArchiveEntry { name: current_name, size: current_size, compressed_size: current_compressed, is_dir });
    }
    Ok(entries)
}

fn compress_impl(window: &tauri::Window, input_paths: Vec<String>, output_path: String, format: Option<String>, level: Option<u8>, password: Option<String>, volume: Option<String>) -> Result<String, String> {
    let fmt = format.unwrap_or_else(|| "zip".into());
    let switch = format_switch(&fmt);
    let mut args: Vec<String> = vec!["a".into(), "-bsp1".into(), format!("-t{}", switch), output_path.clone()];

    let lvl = level.unwrap_or(6);
    args.push(format!("-mx={}", lvl));

    if let Some(ref pw) = password {
        if !pw.is_empty() {
            args.push(format!("-p{}", pw));
            if switch == "zip" || switch == "7z" {
                args.push("-mem=AES256".into());
            }
            if switch == "7z" {
                args.push("-mhe=on".into()); // 加密文件名
            }
        }
    }

    if let Some(ref vol) = volume {
        if !vol.is_empty() {
            args.push(format!("-v{}", vol));
        }
    }

    for ip in &input_paths {
        args.push(ip.clone());
    }

    run_7z_streaming(window, &args)?;

    let meta = std::fs::metadata(&output_path).map_err(|e| format!("无法读取输出文件: {}", e))?;
    Ok(serde_json::json!({ "path": output_path, "size": meta.len() }).to_string())
}

fn extract_impl(window: &tauri::Window, archive_path: String, output_dir: String, password: Option<String>) -> Result<String, String> {
    std::fs::create_dir_all(&output_dir).map_err(|e| format!("无法创建目录: {}", e))?;
    let mut args: Vec<String> = vec!["x".into(), "-bsp1".into(), archive_path, format!("-o{}", output_dir), "-y".into()];
    if let Some(ref pw) = password {
        if !pw.is_empty() {
            args.push(format!("-p{}", pw));
        }
    }
    run_7z_streaming(window, &args)?;
    Ok(serde_json::json!({ "path": output_dir }).to_string())
}

// ---- Commands（async：由后台线程池执行，不阻塞 UI） ----

#[tauri::command]
async fn list_archive(path: String, password: Option<String>) -> Result<Vec<ArchiveEntry>, String> {
    spawn_blocking(move || list_archive_impl(path, password)).await.map_err(|e| format!("任务执行失败: {}", e))?
}

#[tauri::command]
async fn compress_files(
    window: tauri::Window,
    input_paths: Vec<String>,
    output_path: String,
    format: Option<String>,
    level: Option<u8>,
    password: Option<String>,
    volume: Option<String>,
) -> Result<String, String> {
    spawn_blocking(move || compress_impl(&window, input_paths, output_path, format, level, password, volume))
        .await.map_err(|e| format!("任务执行失败: {}", e))?
}

#[tauri::command]
async fn extract_archive(
    window: tauri::Window,
    archive_path: String,
    output_dir: String,
    password: Option<String>,
) -> Result<String, String> {
    spawn_blocking(move || extract_impl(&window, archive_path, output_dir, password))
        .await.map_err(|e| format!("任务执行失败: {}", e))?
}

// 测试压缩包完整性 (7z t)
#[tauri::command]
async fn test_archive(window: tauri::Window, archive_path: String, password: Option<String>) -> Result<String, String> {
    spawn_blocking(move || {
        let mut args: Vec<String> = vec!["t".into(), "-bsp1".into(), archive_path];
        if let Some(ref pw) = password { if !pw.is_empty() { args.push(format!("-p{}", pw)); } }
        let out = run_7z_streaming(&window, &args)?;
        let ok = out.contains("Everything is Ok") || out.contains("No errors");
        Ok(serde_json::json!({ "ok": ok, "detail": out.trim() }).to_string())
    }).await.map_err(|e| format!("任务执行失败: {}", e))?
}

// 向已有压缩包追加文件 (7z a)
#[tauri::command]
async fn add_to_archive(window: tauri::Window, archive_path: String, input_paths: Vec<String>, password: Option<String>) -> Result<String, String> {
    spawn_blocking(move || {
        let mut args: Vec<String> = vec!["a".into(), "-bsp1".into(), archive_path.clone()];
        if let Some(ref pw) = password { if !pw.is_empty() { args.push(format!("-p{}", pw)); } }
        for ip in &input_paths { args.push(ip.clone()); }
        run_7z_streaming(&window, &args)?;
        let size = std::fs::metadata(&archive_path).map(|m| m.len()).unwrap_or(0);
        Ok(serde_json::json!({ "path": archive_path, "size": size }).to_string())
    }).await.map_err(|e| format!("任务执行失败: {}", e))?
}

// 从压缩包删除条目 (7z d)
#[tauri::command]
async fn delete_from_archive(window: tauri::Window, archive_path: String, entries: Vec<String>, password: Option<String>) -> Result<String, String> {
    if entries.is_empty() {
        return Err("未选择要删除的条目".into());
    }
    spawn_blocking(move || {
        let mut args: Vec<String> = vec!["d".into(), "-bsp1".into(), archive_path.clone()];
        if let Some(ref pw) = password { if !pw.is_empty() { args.push(format!("-p{}", pw)); } }
        for e in &entries { args.push(e.clone()); }
        run_7z_streaming(&window, &args)?;
        let size = std::fs::metadata(&archive_path).map(|m| m.len()).unwrap_or(0);
        Ok(serde_json::json!({ "path": archive_path, "size": size }).to_string())
    }).await.map_err(|e| format!("任务执行失败: {}", e))?
}

// 解压单个条目到临时目录并用系统默认程序打开（预览）
#[tauri::command]
async fn extract_and_open(archive_path: String, entry: String, password: Option<String>) -> Result<String, String> {
    spawn_blocking(move || {
        let tmp = std::env::temp_dir().join("uizip_preview");
        std::fs::create_dir_all(&tmp).map_err(|e| format!("无法创建临时目录: {}", e))?;
        let mut args: Vec<String> = vec!["x".into(), archive_path, format!("-o{}", tmp.to_string_lossy()), entry.clone(), "-y".into()];
        if let Some(ref pw) = password { if !pw.is_empty() { args.push(format!("-p{}", pw)); } }
        let str_args: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        run_7z(&str_args)?;
        let target = tmp.join(entry.replace('/', "\\"));
        open_path(&target.to_string_lossy())
    }).await.map_err(|e| format!("任务执行失败: {}", e))?
}

// 在文件资源管理器中定位文件
#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        // explorer 成功时也返回非 0，故不检查退出码
        let _ = Command::new("explorer").arg(format!("/select,{}", path)).spawn();
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("仅支持 Windows".into())
    }
}

fn open_path(path: &str) -> Result<String, String> {
    #[cfg(windows)]
    {
        Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| format!("打开失败: {}", e))?;
        Ok(path.to_string())
    }
    #[cfg(not(windows))]
    {
        Err("仅支持 Windows".into())
    }
}

#[tauri::command]
fn open_file(path: String) -> Result<String, String> {
    open_path(&path)
}

// 取出启动时传入的压缩包路径（文件关联/命令行），取后清空
#[tauri::command]
fn get_launch_archive(state: tauri::State<LaunchArchive>) -> Option<String> {
    state.0.lock().ok().and_then(|mut g| g.take())
}

#[tauri::command]
fn get_file_info(path: String) -> Result<String, String> {
    let metadata = std::fs::metadata(&path).map_err(|e| format!("{}", e))?;
    Ok(serde_json::json!({ "size": metadata.len(), "is_dir": metadata.is_dir() }).to_string())
}

#[tauri::command]
async fn list_files_in_dir(dir_path: String) -> Result<String, String> {
    spawn_blocking(move || {
        let mut files: Vec<serde_json::Value> = Vec::new();
        fn walk(dir: &std::path::Path, files: &mut Vec<serde_json::Value>, base: &std::path::Path) {
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                    let meta = entry.metadata().ok();
                    let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
                    let is_dir = meta.map(|m| m.is_dir()).unwrap_or(false);
                    let rel = path.strip_prefix(base).unwrap_or(&path).to_string_lossy().to_string();
                    files.push(serde_json::json!({ "name": name, "path": path.to_string_lossy(), "rel": rel, "size": size, "is_dir": is_dir }));
                    if is_dir {
                        walk(&path, files, base);
                    }
                }
            }
        }
        let p = std::path::Path::new(&dir_path);
        if !p.is_dir() {
            return Err(format!("{} 不是有效目录", dir_path));
        }
        walk(p, &mut files, p);
        Ok(serde_json::json!(files).to_string())
    }).await.map_err(|e| format!("任务执行失败: {}", e))?
}

#[tauri::command]
fn dialog_open(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    match app.dialog().file().blocking_pick_files() {
        Some(files) => Ok(files.into_iter().map(|f| f.to_string()).collect()),
        None => Ok(vec![]),
    }
}

#[tauri::command]
fn dialog_pick_folders(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    match app.dialog().file().blocking_pick_folders() {
        Some(folders) => Ok(folders.into_iter().map(|f| f.to_string()).collect()),
        None => Ok(vec![]),
    }
}

#[tauri::command]
fn dialog_pick_archive(app: tauri::AppHandle) -> Result<String, String> {
    match app.dialog().file()
        .add_filter("所有压缩包", &["zip", "7z", "rar", "tar", "gz", "bz2", "xz", "iso", "cab", "arj", "lzh", "zst", "lzma"])
        .add_filter("ZIP", &["zip"])
        .add_filter("7-Zip", &["7z"])
        .add_filter("RAR", &["rar"])
        .add_filter("TAR", &["tar", "gz", "bz2", "xz"])
        .blocking_pick_file()
    {
        Some(f) => Ok(f.to_string()),
        None => Ok(String::new()),
    }
}

#[tauri::command]
fn dialog_pick_folder(app: tauri::AppHandle) -> Result<String, String> {
    match app.dialog().file().blocking_pick_folder() {
        Some(f) => Ok(f.to_string()),
        None => Ok(String::new()),
    }
}

// 从命令行参数里找出第一个存在的文件（文件关联双击时即为该压缩包）
fn first_file_arg<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter().skip(1).find(|a| !a.starts_with('-') && std::path::Path::new(a).is_file())
}

fn focus_main(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    let w = app.get_webview_window("main")?;
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
    Some(w)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例：第二次启动（如再双击一个压缩包）转发给已运行窗口
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let arch = first_file_arg(argv.iter().cloned());
            if let Some(_w) = focus_main(app) {
                if let Some(p) = arch {
                    let _ = app.emit("open-archive", p);
                }
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(LaunchArchive(Mutex::new(first_file_arg(std::env::args()))))
        .setup(|app| {
            // ---- 系统托盘（后台保留） ----
            let show_i = MenuItem::with_id(app, "show", "显示 uiZip", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;
            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("uiZip")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => { focus_main(app); }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        focus_main(tray.app_handle());
                    }
                })
                .build(app)?;

            // ---- 关闭窗口 = 隐藏到托盘，进程后台常驻 ----
            if let Some(w) = app.get_webview_window("main") {
                let wc = w.clone();
                w.on_window_event(move |e| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = e {
                        api.prevent_close();
                        let _ = wc.hide();
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_archive,
            compress_files,
            extract_archive,
            test_archive,
            add_to_archive,
            delete_from_archive,
            extract_and_open,
            reveal_in_explorer,
            open_file,
            get_launch_archive,
            get_file_info,
            dialog_open,
            list_files_in_dir,
            dialog_pick_folders,
            dialog_pick_archive,
            dialog_pick_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
