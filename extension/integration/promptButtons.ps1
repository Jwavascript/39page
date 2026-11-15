# 실제 Chrome 통합 하네스 보조 — 지정한 Chrome 프로세스 창의 단추 이름을 모두 적는다 (프롬프트 단추 이름이 버전마다 다를 때).
param([Parameter(Mandatory = $true)][int]$ProcessId)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$byPid = New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, $ProcessId)
$isButton = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
foreach ($window in $AE::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $byPid)) {
  foreach ($button in $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $isButton)) { Write-Output ("[" + $window.Current.Name + "] " + $button.Current.Name) }
}
