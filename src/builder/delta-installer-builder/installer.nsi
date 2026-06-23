; ============================================================
; NSIS 差量安装器模板
; ============================================================
;
; 由 DeltaInstallerBuilder 编译，参数通过 -D 传入:
;   PRODUCT_NAME          应用名称
;   PROCESS_NAME          进程名 (KillProcess 杀)
;   PRODUCT_ICON_PATH     安装器图标
;   INSTALLER_OUTPUT_PATH 输出 .exe 路径
;   DELTA_FILE_PATH       嵌入的 .delta 文件
;   DELTA_FILE_NAME       .delta 文件名
;
; 运行时参数 (/D 已废弃，新方式通过 GetParameters 传递):
;   /APPPATH="..."         应用安装目录
;   /RESTART="1"|"0"      是否打完补丁后重启
;
; ============================================================
; 执行流程
; ============================================================
;
;   1. 解析命令行参数 /APPPATH /RESTART
;   2. KillProcess 杀主进程 (释放文件锁)
;   3. 解压 hpatchz.exe + .delta 到临时目录
;   4. hpatchz.exe 将补丁应用到安装目录
;   5. 成功 → 重启应用; 失败 → 退出不重启
; ============================================================

!include FileFunc.nsh
!include LogicLib.nsh

Name "${PRODUCT_NAME}-Delta-Updater"
OutFile "${INSTALLER_OUTPUT_PATH}"

; 以最高权限运行 (确保能写 C:\Program Files 等受保护目录)
RequestExecutionLevel highest

ShowInstDetails nevershow
Unicode true

Icon "${PRODUCT_ICON_PATH}"
SilentInstall silent

InstallDir "$LocalAppData\Programs\${PRODUCT_NAME}-delta-updater"

Var /GLOBAL apppath
Var /GLOBAL restart

# avoid exit code 2
!macro quitSuccess
  SetErrorLevel 0
  Quit
!macroend


Section "gen_package" SEC01

    ; ---- 1. 解析命令行参数 ----
    ${GetParameters} $0
    ${GetOptions} $0 "/APPPATH=" $apppath
    ${GetParameters} $0
    ${GetOptions} $0 "/RESTART=" $restart

    DetailPrint "message: args: $0"
    DetailPrint "message: APPPATH: $apppath"
    DetailPrint "message: RESTART: $restart"


    SetDetailsPrint both

    ; ---- 2. 杀主进程 (释放文件锁，确保 hpatchz 能覆写) ----
	  nsProcess::_KillProcess "${PROCESS_NAME}.exe" $R0
    Pop $R0
    nsProcess::_Unload

    SetOutPath $INSTDIR

    ; ---- 3. 解压补丁工具 & 文件 ----
    RMDir /r $INSTDIR

    File "hpatchz.exe"
    File "${DELTA_FILE_PATH}"

    ; ---- 4. 应用差量补丁 ----
    ; -C-all: 校验所有差异; -f: 强制覆写
    nsExec::ExecToLog '"$INSTDIR\hpatchz.exe" -C-all "$apppath" "$INSTDIR\${DELTA_FILE_NAME}" "$apppath" -f'
    Pop $0  ; hpatchz exit code

    ; ---- 5. 检查结果 ----
    ; hpatchz 失败时不重启 → 应用下次启动检测到版本未变 → 回退全量
    ${If} $0 != 0
       DetailPrint "hpatchz failed with exit code $0, aborting restart"
       SetErrorLevel $0
       Quit
    ${EndIf}

    DetailPrint $apppath
    DetailPrint  "$apppath\${PROCESS_NAME}.exe"
    DetailPrint $restart

    ; ---- 6. 重启应用 ----
    ${If} $restart == "1"
       ShellExecAsUser::ShellExecAsUser "" "$apppath\${PROCESS_NAME}.exe" "--updated"
    ${Else}
       DetailPrint "$RESTART IS 0 switch found"
    ${EndIf}

    !insertmacro quitSuccess
SectionEnd
