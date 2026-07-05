; uiZip NSIS 安装钩子：PATH 注册 + WebView2 静默安装

!macro customInstall
  ; --- 静默安装 WebView2 Runtime ---
  ; 如果检测不到 WebView2，运行内嵌的引导程序（静默模式）
  ReadRegStr  HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  StrCmp  "" install_webview2 skip_webview2
  install_webview2:
    ; 从安装目录运行引导程序（静默安装）
    ExecWait '"\resources\MicrosoftEdgeWebview2Setup.exe" /silent /install' 
  skip_webview2:

  ; --- PATH 环境变量注册 ---
  ReadRegStr  HKCU "Environment" "Path"
  StrCmp  "" uizip_path_empty uizip_path_append
  uizip_path_empty:
    WriteRegExpandStr HKCU "Environment" "Path" ""
    Goto uizip_path_done
  uizip_path_append:
    WriteRegExpandStr HKCU "Environment" "Path" ";"
  uizip_path_done:
  SendMessage 0xFFFF 0x1A 0 "STR:Environment" /TIMEOUT=500
!macroend

!macro customUninstall
  ReadRegStr  HKCU "Environment" "Path"
  StrCmp  "" uizip_unpath_clear uizip_unpath_done
  uizip_unpath_clear:
    DeleteRegValue HKCU "Environment" "Path"
  uizip_unpath_done:
  SendMessage 0xFFFF 0x1A 0 "STR:Environment" /TIMEOUT=500
!macroend
