; PDF 全能工作台 安装包脚本（NSIS 3.x，需 UTF-8 BOM）
; 用法: makensis /DARCH=x64 installer.nsi   （ARCH = x64 | ia32）

!include "MUI2.nsh"

!define APPNAME "PDF全能工作台"
!define VERSION "1.0.0"
!define REGROOT HKCU
!define EXENAME "PDF全能工作台.exe"

!ifndef ARCH
  !define ARCH "x64"
!endif

!if "${ARCH}" == "ia32"
  !define SRCDIR "_build\electron-ia32"
  !define OUTFILE "out\PDFStudio-Setup-1.0.0-ia32.exe"
  !define INSTSUBDIR "PDFStudio32"
  !define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\PDFStudio32"
!else
  !define SRCDIR "_build\electron-x64"
  !define OUTFILE "out\PDFStudio-Setup-1.0.0-x64.exe"
  !define INSTSUBDIR "PDFStudio"
  !define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\PDFStudio"
!endif

Name "${APPNAME}"
Unicode true
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\${INSTSUBDIR}"
InstallDirRegKey ${REGROOT} "${REGKEY}" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma

; 界面
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

; 安装前若程序在运行则先关闭
!macro KillApp
  nsExec::Exec 'taskkill /IM "${EXENAME}" /F'
!macroend

Section "Install"
  !insertmacro KillApp
  SetOutPath "$INSTDIR"
  File /r "${SRCDIR}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; 快捷方式（直连主程序）
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\app\${EXENAME}" "" "$INSTDIR\app\${EXENAME}" 0 SW_SHOWNORMAL "" "$INSTDIR\app"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\卸载 ${APPNAME}.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\app\${EXENAME}" "" "$INSTDIR\app\${EXENAME}" 0 SW_SHOWNORMAL "" "$INSTDIR\app"

  ; PDF 关联（HKCU，可选打开方式中出现）
  WriteRegStr ${REGROOT} "Software\Classes\${INSTSUBDIR}.pdf" "" "PDF Document"
  WriteRegStr ${REGROOT} "Software\Classes\${INSTSUBDIR}.pdf\DefaultIcon" "" "$INSTDIR\app\${EXENAME},0"
  WriteRegStr ${REGROOT} "Software\Classes\${INSTSUBDIR}.pdf\shell\open\command" "" '"$INSTDIR\app\${EXENAME}" "%1"'

  ; 添加/删除程序 注册信息
  WriteRegStr ${REGROOT} "${REGKEY}" "DisplayName" "${APPNAME} ${VERSION}"
  WriteRegStr ${REGROOT} "${REGKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr ${REGROOT} "${REGKEY}" "Publisher" "PDFStudio"
  WriteRegStr ${REGROOT} "${REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr ${REGROOT} "${REGKEY}" "DisplayIcon" "$INSTDIR\app\${EXENAME}"
  WriteRegStr ${REGROOT} "${REGKEY}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegDWORD ${REGROOT} "${REGKEY}" "NoModify" 1
  WriteRegDWORD ${REGROOT} "${REGKEY}" "NoRepair" 1

  WriteRegStr ${REGROOT} "Software\${INSTSUBDIR}" "" "$INSTDIR"
SectionEnd

Section "Uninstall"
  !insertmacro KillApp
  Delete "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\卸载 ${APPNAME}.lnk"
  RMDir "$SMPROGRAMS\${APPNAME}"
  Delete "$DESKTOP\${APPNAME}.lnk"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR"
  DeleteRegKey ${REGROOT} "${REGKEY}"
  DeleteRegKey ${REGROOT} "Software\${INSTSUBDIR}"
  DeleteRegKey ${REGROOT} "Software\Classes\${INSTSUBDIR}.pdf"
SectionEnd
