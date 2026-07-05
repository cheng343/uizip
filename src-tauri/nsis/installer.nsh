; uiZip NSIS 安装钩子：把安装目录加入当前用户 PATH（可在终端直接 uizip file.zip）
; 只用核心指令 StrCmp + 数字常量，避免依赖额外 include，保证 CI 编译通过。
; HWND_BROADCAST=0xFFFF, WM_SETTINGCHANGE=0x1A

!macro customInstall
  ReadRegStr $0 HKCU "Environment" "Path"
  StrCmp $0 "" uizip_path_empty uizip_path_append
  uizip_path_empty:
    WriteRegExpandStr HKCU "Environment" "Path" "$INSTDIR"
    Goto uizip_path_done
  uizip_path_append:
    ; ponytail: 不做子串查重，重复安装可能追加重复项（无害）；精确查重需 StrFunc，为保证编译稳定这里省略。
    WriteRegExpandStr HKCU "Environment" "Path" "$0;$INSTDIR"
  uizip_path_done:
  SendMessage 0xFFFF 0x1A 0 "STR:Environment" /TIMEOUT=500
!macroend

!macro customUninstall
  ReadRegStr $0 HKCU "Environment" "Path"
  ; 仅当 PATH 恰好等于本程序目录时才清除；处于中间的项需子串操作，此处不动以免误删他人 PATH。
  StrCmp $0 "$INSTDIR" uizip_unpath_clear uizip_unpath_done
  uizip_unpath_clear:
    DeleteRegValue HKCU "Environment" "Path"
  uizip_unpath_done:
  SendMessage 0xFFFF 0x1A 0 "STR:Environment" /TIMEOUT=500
!macroend
