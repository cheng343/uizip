!macro customInstall
  ; Add to PATH for current user
  ReadRegStr  HKCU "Environment" "Path"
  ; Remove old entry if exists
    != ""
       ""
      == ""
      ; Only add if not already present
      WriteRegExpandStr HKCU "Environment" "Path" ";"
    
  
    WriteRegExpandStr HKCU "Environment" "Path" ""
  
  ; Notify system of env change
  SendMessage   0 "STR:Environment" /TIMEOUT=500
!macroend

!macro customUninstall
  ; Remove from PATH
  ReadRegStr  HKCU "Environment" "Path"
    != ""
       ""
      != ""
      ; Remove our directory from PATH
         ";" ""
         ";" ""
        == ""
        DeleteRegValue HKCU "Environment" "Path"
      
        WriteRegExpandStr HKCU "Environment" "Path" ""
      
    
  
  SendMessage   0 "STR:Environment" /TIMEOUT=500
!macroend
