; OMNI-CODE v1.0 per-user Windows installer (no admin required)
!define PRODUCT_NAME "OMNI-CODE"
!define PRODUCT_VERSION "1.0.0"
!define PRODUCT_PUBLISHER "tattooinmtl"
!define PRODUCT_WEB "https://github.com/tattooinmtl/omni-neural-ide"
!define REGPATH_UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "..\..\..\omni-installer\OMNI-CODE-Setup-1.0.0.exe"
Unicode True
SetCompressor /SOLID lzma
RequestExecutionLevel user
InstallDir ""
InstallDirRegKey HKCU "${REGPATH_UNINST}" "InstallLocation"
ShowInstDetails show
ShowUninstDetails show
BrandingText "${PRODUCT_NAME} ${PRODUCT_VERSION}"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"
!include "WinVer.nsh"

!define MUI_ABORTWARNING
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\bin\launcher.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch OMNI-CODE"
!define MUI_FINISHPAGE_LINK "OMNI-CODE on GitHub"
!define MUI_FINISHPAGE_LINK_LOCATION "${PRODUCT_WEB}"

Var StartMenuFolder

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_STARTMENU Application $StartMenuFolder
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Function .onInit
  SetShellVarContext current
  ${If} $InstDir == ""
    StrCpy $InstDir "$LOCALAPPDATA\Programs\OMNI-CODE"
  ${EndIf}
FunctionEnd

Function un.onInit
  SetShellVarContext current
FunctionEnd

; Detect WebView2 Evergreen Runtime via registry
Function CheckWebView2
  ; Prefer 64-bit view of registry on 64-bit Windows
  SetRegView 64
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $0 == ""
    ReadRegStr $0 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  ${If} $0 == ""
    ReadRegStr $0 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  SetRegView lastused
  ${If} $0 == ""
    DetailPrint "WebView2 Runtime not found — launching Evergreen bootstrapper..."
    ; Silent bootstrapper; may need network. Non-fatal if it fails (user can install later).
    nsExec::ExecToLog '"$INSTDIR\webview2\MicrosoftEdgeWebview2Setup.exe" /silent /install'
    Pop $1
    DetailPrint "WebView2 bootstrapper exit code: $1"
  ${Else}
    DetailPrint "WebView2 Runtime present (pv=$0)"
  ${EndIf}
FunctionEnd

Section "OMNI-CODE (required)" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"

  ; Create layout
  CreateDirectory "$INSTDIR\bin"
  CreateDirectory "$INSTDIR\ui\dist"
  CreateDirectory "$INSTDIR\fixtures"
  CreateDirectory "$INSTDIR\keys"
  CreateDirectory "$INSTDIR\sandbox"
  CreateDirectory "$INSTDIR\checkpoints"
  CreateDirectory "$INSTDIR\webview2"

  ; Binaries
  SetOutPath "$INSTDIR\bin"
  File "/oname=launcher.exe" "..\..\..\omni-installer\payload\bin\launcher.exe"
  File "/oname=omni-core.exe" "..\..\..\omni-installer\payload\bin\omni-core.exe"

  ; Prebuilt UI (no npm on user machine)
  SetOutPath "$INSTDIR\ui\dist"
  File /r "..\..\..\omni-installer\payload\ui\dist\*.*"

  ; Demo fixtures
  SetOutPath "$INSTDIR\fixtures"
  File /r "..\..\..\omni-installer\payload\fixtures\*.*"

  ; Docs + WebView2 bootstrapper
  SetOutPath "$INSTDIR"
  File "/oname=README.txt" "..\..\..\omni-installer\payload\README.txt"
  SetOutPath "$INSTDIR\webview2"
  File "/oname=MicrosoftEdgeWebview2Setup.exe" "..\..\..\omni-installer\payload\webview2\MicrosoftEdgeWebview2Setup.exe"

  ; Uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Add/Remove Programs (HKCU — per-user)
  WriteRegStr HKCU "${REGPATH_UNINST}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "${REGPATH_UNINST}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "${REGPATH_UNINST}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "${REGPATH_UNINST}" "URLInfoAbout" "${PRODUCT_WEB}"
  WriteRegStr HKCU "${REGPATH_UNINST}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${REGPATH_UNINST}" "DisplayIcon" "$INSTDIR\bin\launcher.exe,0"
  WriteRegStr HKCU "${REGPATH_UNINST}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${REGPATH_UNINST}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${REGPATH_UNINST}" "NoModify" 1
  WriteRegDWORD HKCU "${REGPATH_UNINST}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${REGPATH_UNINST}" "EstimatedSize" "$0"

  ; OMNI_HOME default via user env (so launcher finds install even if moved logic changes)
  WriteRegStr HKCU "Environment" "OMNI_HOME" "$INSTDIR"

  Call CheckWebView2
SectionEnd

Section "Start Menu shortcut" SecSM
  !insertmacro MUI_STARTMENU_WRITE_BEGIN Application
  CreateDirectory "$SMPROGRAMS\$StartMenuFolder"
  CreateShortCut "$SMPROGRAMS\$StartMenuFolder\OMNI-CODE.lnk" "$INSTDIR\bin\launcher.exe" "" "$INSTDIR\bin\launcher.exe" 0 SW_SHOWNORMAL "" "OMNI-CODE launcher"
  CreateShortCut "$SMPROGRAMS\$StartMenuFolder\Uninstall OMNI-CODE.lnk" "$INSTDIR\Uninstall.exe"
  !insertmacro MUI_STARTMENU_WRITE_END
SectionEnd

Section "Desktop shortcut" SecDesktop
  CreateShortCut "$DESKTOP\OMNI-CODE.lnk" "$INSTDIR\bin\launcher.exe" "" "$INSTDIR\bin\launcher.exe" 0 SW_SHOWNORMAL "" "OMNI-CODE launcher"
SectionEnd

Section "Uninstall"
  ; Remove shortcuts
  !insertmacro MUI_STARTMENU_GETFOLDER Application $StartMenuFolder
  Delete "$SMPROGRAMS\$StartMenuFolder\OMNI-CODE.lnk"
  Delete "$SMPROGRAMS\$StartMenuFolder\Uninstall OMNI-CODE.lnk"
  RMDir "$SMPROGRAMS\$StartMenuFolder"
  Delete "$DESKTOP\OMNI-CODE.lnk"

  ; Remove files (keep keys/ — user credentials)
  RMDir /r "$INSTDIR\bin"
  RMDir /r "$INSTDIR\ui"
  RMDir /r "$INSTDIR\fixtures"
  RMDir /r "$INSTDIR\webview2"
  RMDir /r "$INSTDIR\sandbox"
  RMDir /r "$INSTDIR\checkpoints"
  Delete "$INSTDIR\README.txt"
  Delete "$INSTDIR\Uninstall.exe"

  ; Registry
  DeleteRegKey HKCU "${REGPATH_UNINST}"
  ; Only clear OMNI_HOME if it still points at this install
  ReadRegStr $0 HKCU "Environment" "OMNI_HOME"
  ${If} $0 == "$INSTDIR"
    DeleteRegValue HKCU "Environment" "OMNI_HOME"
  ${EndIf}

  RMDir "$INSTDIR"
SectionEnd
