!macro customUnInstall
  ${IfNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_FILENAME}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
    ${IfNot} ${Silent}
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Delete Glyph-on settings and backups? Choose No to keep them.$\r$\nGlyph-on の設定とバックアップを削除しますか？「いいえ」で残します。" IDNO +2
      RMDir /r "$APPDATA\Glyph-on"
    ${EndIf}
  ${EndIf}
!macroend
