use serde::{Deserialize, Serialize};
use std::process::Command;
use std::path::PathBuf;
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

fn run_7z(args: &[&str]) -> Result<String, String> {
    let exe = find_7z();
    let output = Command::new(&exe)
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

// ---- Commands ----

#[tauri::command]
fn list_archive(path: String, password: Option<String>) -> Result<Vec<ArchiveEntry>, String> {
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
        } else if line.starts_with("Compressed Size = ") {
            current_compressed = line[18..].trim().trim_start_matches('+').parse().unwrap_or(0);
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

#[tauri::command]
fn compress_files(
    input_paths: Vec<String>,
    output_path: String,
    format: Option<String>,    // zip, 7z, tar, wim
    level: Option<u8>,         // 0-9
    password: Option<String>,
    volume: Option<String>,    // e.g. "100M", "4G"
) -> Result<String, String> {
    let fmt = format.unwrap_or_else(|| "zip".into());
    let switch = format_switch(&fmt);
    let mut args: Vec<String> = vec!["a".into(), format!("-t{}", switch), output_path.clone()];

    let lvl = level.unwrap_or(6);
    args.push(format!("-mx={}", lvl));

    if let Some(ref pw) = password {
        if !pw.is_empty() {
            args.push(format!("-p{}", pw));
            if switch == "zip" || switch == "7z" {
                args.push("-mem=AES256".into());
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

    let str_args: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_7z(&str_args)?;

    let meta = std::fs::metadata(&output_path).map_err(|e| format!("无法读取输出文件: {}", e))?;
    Ok(serde_json::json!({ "path": output_path, "size": meta.len() }).to_string())
}

#[tauri::command]
fn extract_archive(
    archive_path: String,
    output_dir: String,
    password: Option<String>,
) -> Result<String, String> {
    std::fs::create_dir_all(&output_dir).map_err(|e| format!("无法创建目录: {}", e))?;
    let mut args: Vec<String> = vec!["x".into(), archive_path, format!("-o{}", output_dir), "-y".into()];
    if let Some(ref pw) = password {
        if !pw.is_empty() {
            args.push(format!("-p{}", pw));
        }
    }
    let str_args: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_7z(&str_args)?;
    Ok(serde_json::json!({ "path": output_dir }).to_string())
}

#[tauri::command]
fn get_file_info(path: String) -> Result<String, String> {
    let metadata = std::fs::metadata(&path).map_err(|e| format!("{}", e))?;
    Ok(serde_json::json!({ "size": metadata.len(), "is_dir": metadata.is_dir() }).to_string())
}

#[tauri::command]
fn list_files_in_dir(dir_path: String) -> Result<String, String> {
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
        return Err(format!("{} ?????", dir_path));
    }
    walk(p, &mut files, p);
    Ok(serde_json::json!(files).to_string())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_archive,
            compress_files,
            extract_archive,
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
