; uiZip NSIS 安装钩子

!macro customInstall
  ; 把 WebView2Loader.dll 从 resources 复制到安装根目录
  CopyFiles "\resources\WebView2Loader.dll" ""

  ; PATH 注册
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
  Delete "\WebView2Loader.dll"
  ReadRegStr  HKCU "Environment" "Path"
  StrCmp  "" uizip_unpath_clear uizip_unpath_done
  uizip_unpath_clear:
    DeleteRegValue HKCU "Environment" "Path"
  uizip_unpath_done:
  SendMessage 0xFFFF 0x1A 0 "STR:Environment" /TIMEOUT=500
!macroend
