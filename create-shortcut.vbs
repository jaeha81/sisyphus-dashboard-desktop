Set WshShell = WScript.CreateObject("WScript.Shell")
Set FSO      = CreateObject("Scripting.FileSystemObject")

AppDir  = FSO.GetParentFolderName(WScript.ScriptFullName)
Desktop = WshShell.SpecialFolders("Desktop")
LnkPath = Desktop & "\Sisyphus Dashboard.lnk"

Set SC = WshShell.CreateShortcut(LnkPath)
SC.TargetPath       = "cmd.exe"
SC.Arguments        = "/c """ & AppDir & "\dev-start.bat"""
SC.WorkingDirectory = AppDir
SC.WindowStyle      = 1
SC.Description      = "Sisyphus Dashboard - OpenCode AI Coding"

ElectronExe = AppDir & "\node_modules\electron\dist\electron.exe"
If FSO.FileExists(ElectronExe) Then
    SC.IconLocation = ElectronExe & ",0"
End If

SC.Save

MsgBox "바탕화면에 'Sisyphus Dashboard' 바로가기가 생성되었습니다!" & Chr(10) & LnkPath, vbInformation, "Sisyphus Dashboard"
