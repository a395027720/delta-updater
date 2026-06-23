!include FileFunc.nsh
!include LogicLib.nsh

Name "${PRODUCT_NAME}-Delta-Updater"
OutFile "${INSTALLER_OUTPUT_PATH}"
RequestExecutionLevel highest
ShowInstDetails nevershow
Unicode true

Icon "${PRODUCT_ICON_PATH}"
SilentInstall silent

InstallDir "$LocalAppData\Programs\${PRODUCT_NAME}-delta-updater"

Var /GLOBAL apppath
Var /GLOBAL restart

!macro quitSuccess
  SetErrorLevel 0
  Quit
!macroend


Section "gen_package" SEC01

    ${GetParameters} $0
    ${GetOptions} $0 "/APPPATH=" $apppath
    ${GetParameters} $0
    ${GetOptions} $0 "/RESTART=" $restart

    DetailPrint "message: args: $0"
    DetailPrint "message: APPPATH: $apppath"
    DetailPrint "message: RESTART: $restart"


    SetDetailsPrint both
	  nsProcess::_KillProcess "${PROCESS_NAME}.exe" $R0
    Pop $R0
    nsProcess::_Unload

    SetOutPath $INSTDIR

    RMDir /r $INSTDIR

    File "hpatchz.exe"
    File "${DELTA_FILE_PATH}"

    nsExec::ExecToLog '"$INSTDIR\hpatchz.exe" -C-all "$apppath" "$INSTDIR\${DELTA_FILE_NAME}" "$apppath" -f'
    Pop $0

    ${If} $0 != 0
       DetailPrint "hpatchz failed with exit code $0, aborting restart"
       SetErrorLevel $0
       Quit
    ${EndIf}

    DetailPrint $apppath
    DetailPrint  "$apppath\${PROCESS_NAME}.exe"
    DetailPrint $restart

    ${If} $restart == "1"
       ShellExecAsUser::ShellExecAsUser "" "$apppath\${PROCESS_NAME}.exe" "--updated"
    ${Else}
       DetailPrint "$RESTART IS 0 switch found"
    ${EndIf}

    !insertmacro quitSuccess
SectionEnd
