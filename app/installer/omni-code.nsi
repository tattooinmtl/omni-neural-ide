; OMNI-CODE v1.3.0 per-user Windows installer (no admin)
; Installs to %USERPROFILE%\.omni-neural-ide
!define PRODUCT_NAME "OMNI-CODE"
!define PRODUCT_VERSION "1.3.0"
!define PRODUCT_PUBLISHER "tattooinmtl"
!define PRODUCT_WEB "https://github.com/tattooinmtl/omni-neural-ide"
!define REGPATH_UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
!define OLD_INSTALL_DIR "$LOCALAPPDATA\Programs\OMNI-CODE"

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "..\..\..\omni-installer\OMNI-CODE-Setup-1.3.0.exe"
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
!define MUI_ICON "..\..\..\omni-installer\icons\omni.ico"
!define MUI_UNICON "..\..\..\omni-installer\icons\omni.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\bin\launcher.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch OMNI-CODE Gateway"
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
    StrCpy $InstDir "$PROFILE\.omni-neural-ide"
  ${EndIf}
FunctionEnd

Function un.onInit
  SetShellVarContext current
FunctionEnd

; Remove leftover v1.0 install under %LOCALAPPDATA%\Programs\OMNI-CODE
Function RemoveLegacyInstall
  StrCpy $0 "${OLD_INSTALL_DIR}"
  IfFileExists "$0\Uninstall.exe" 0 legacy_files
    DetailPrint "Removing previous v1.0 install at $0 ..."
    nsExec::ExecToLog '"$0\Uninstall.exe" /S'
    Pop $1
  legacy_files:
  IfFileExists "$0\*.*" 0 legacy_shortcuts
    RMDir /r "$0"
  legacy_shortcuts:
  ; Old Start Menu / Desktop shortcuts that pointed at Programs\OMNI-CODE
  Delete "$SMPROGRAMS\OMNI-CODE\OMNI-CODE.lnk"
  Delete "$SMPROGRAMS\OMNI-CODE\Uninstall OMNI-CODE.lnk"
  RMDir "$SMPROGRAMS\OMNI-CODE"
  Delete "$DESKTOP\OMNI-CODE.lnk"
  ; If registry still points at the old path, clear it (new install rewrites it)
  ReadRegStr $1 HKCU "${REGPATH_UNINST}" "InstallLocation"
  ${If} $1 == "$0"
    DeleteRegKey HKCU "${REGPATH_UNINST}"
  ${EndIf}
  ReadRegStr $1 HKCU "Environment" "OMNI_HOME"
  ${If} $1 == "$0"
    DeleteRegValue HKCU "Environment" "OMNI_HOME"
  ${EndIf}
FunctionEnd

Function CheckWebView2
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
    nsExec::ExecToLog '"$INSTDIR\webview2\MicrosoftEdgeWebview2Setup.exe" /silent /install'
    Pop $1
    DetailPrint "WebView2 bootstrapper exit code: $1"
  ${Else}
    DetailPrint "WebView2 Runtime present (pv=$0)"
  ${EndIf}
FunctionEnd

Section "OMNI-CODE (required)" SecMain
  SectionIn RO

  Call RemoveLegacyInstall

  SetOutPath "$INSTDIR"
  CreateDirectory "$INSTDIR\bin"
  CreateDirectory "$INSTDIR\ui\dist"
  CreateDirectory "$INSTDIR\fixtures"
  CreateDirectory "$INSTDIR\keys"
  CreateDirectory "$INSTDIR\sandbox"
  CreateDirectory "$INSTDIR\checkpoints"
  CreateDirectory "$INSTDIR\logs"
  CreateDirectory "$INSTDIR\webview2"

  SetOutPath "$INSTDIR\bin"
  File "/oname=launcher.exe" "..\..\..\omni-installer\payload\bin\launcher.exe"
  File "/oname=omni-core.exe" "..\..\..\omni-installer\payload\bin\omni-core.exe"
  File "/oname=WebView2Loader.dll" "..\..\..\omni-installer\payload\bin\WebView2Loader.dll"
  File "/oname=libunwind.dll" "..\..\..\omni-installer\payload\bin\libunwind.dll"
  File "/oname=omni-updater.exe" "..\..\..\omni-installer\payload\bin\omni-updater.exe"

  SetOutPath "$INSTDIR\ui\dist"
  File /r "..\..\..\omni-installer\payload\ui\dist\*.*"

  SetOutPath "$INSTDIR\fixtures"
  File /r "..\..\..\omni-installer\payload\fixtures\*.*"

  SetOutPath "$INSTDIR"
  File "/oname=version" "..\..\..\omni-installer\payload\version"
  File "/oname=README.txt" "..\..\..\omni-installer\payload\README.txt"
  SetOutPath "$INSTDIR\assets"
  File "/oname=omni-logo.bmp" "..\..\..\omni-installer\payload\assets\omni-logo.bmp"
  File "/oname=omni.ico" "..\..\..\omni-installer\payload\assets\omni.ico"
  File "/oname=omni-icon-256.png" "..\..\..\omni-installer\payload\assets\omni-icon-256.png"
  SetOutPath "$INSTDIR\webview2"
  File "/oname=MicrosoftEdgeWebview2Setup.exe" "..\..\..\omni-installer\payload\webview2\MicrosoftEdgeWebview2Setup.exe"

  WriteUninstaller "$INSTDIR\Uninstall.exe"

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

  WriteRegStr HKCU "Environment" "OMNI_HOME" "$INSTDIR"

  Call CheckWebView2
SectionEnd

Section "Start Menu shortcut" SecSM
  !insertmacro MUI_STARTMENU_WRITE_BEGIN Application
  CreateDirectory "$SMPROGRAMS\$StartMenuFolder"
  CreateShortCut "$SMPROGRAMS\$StartMenuFolder\OMNI-CODE.lnk" "$INSTDIR\bin\launcher.exe" "" "$INSTDIR\bin\launcher.exe" 0 SW_SHOWNORMAL "" "OMNI-CODE Gateway"
  CreateShortCut "$SMPROGRAMS\$StartMenuFolder\Uninstall OMNI-CODE.lnk" "$INSTDIR\Uninstall.exe"
  !insertmacro MUI_STARTMENU_WRITE_END
SectionEnd

Section "Desktop shortcut" SecDesktop
  CreateShortCut "$DESKTOP\OMNI-CODE.lnk" "$INSTDIR\bin\launcher.exe" "" "$INSTDIR\bin\launcher.exe" 0 SW_SHOWNORMAL "" "OMNI-CODE Gateway"
SectionEnd

Section "Uninstall"
  !insertmacro MUI_STARTMENU_GETFOLDER Application $StartMenuFolder
  Delete "$SMPROGRAMS\$StartMenuFolder\OMNI-CODE.lnk"
  Delete "$SMPROGRAMS\$StartMenuFolder\Uninstall OMNI-CODE.lnk"
  RMDir "$SMPROGRAMS\$StartMenuFolder"
  Delete "$DESKTOP\OMNI-CODE.lnk"

  RMDir /r "$INSTDIR\bin"
  RMDir /r "$INSTDIR\ui"
  RMDir /r "$INSTDIR\fixtures"
  RMDir /r "$INSTDIR\webview2"
  RMDir /r "$INSTDIR\sandbox"
  RMDir /r "$INSTDIR\checkpoints"
  ; keep keys\ and logs\ (user data)
  Delete "$INSTDIR\README.txt"
  Delete "$INSTDIR\Uninstall.exe"

  DeleteRegKey HKCU "${REGPATH_UNINST}"
  ReadRegStr $0 HKCU "Environment" "OMNI_HOME"
  ${If} $0 == "$INSTDIR"
    DeleteRegValue HKCU "Environment" "OMNI_HOME"
  ${EndIf}

  RMDir "$INSTDIR"
SectionEnd
