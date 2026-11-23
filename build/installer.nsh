!macro RemoveOwnedRinkuProtocol ROOT
  ReadRegStr $0 ${ROOT} "Software\Classes\rinku\shell\open\command" ""
  ${If} $0 == '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
    DeleteRegKey ${ROOT} "Software\Classes\rinku"
  ${EndIf}
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
    Push $0
    !insertmacro RemoveOwnedRinkuProtocol SHELL_CONTEXT
    ; Electron registers per-user even when the installer runs for all users.
    !insertmacro RemoveOwnedRinkuProtocol HKCU
    Pop $0
  ${EndIf}
!macroend
