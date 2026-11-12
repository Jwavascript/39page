# M11 PoC — permissions.request() 가 띄운 실제 Chrome 권한 프롬프트의 단추를 Windows UI Automation 으로 누른다.
# ⚠ 실험 도구. 지정한 프로세스(격리 프로필로 띄운 Chrome for Testing)의 창만 찾는다 — 다른 Chrome 창은 건드리지 않는다.
param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][string]$Names,   # 'Allow|허용' 처럼 | 로 구분
  [int]$TimeoutMs = 15000
)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$wanted = $Names -split '\|'
$byPid = New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, $ProcessId)
$isButton = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$deadline = (Get-Date).AddMilliseconds($TimeoutMs)
while ((Get-Date) -lt $deadline) {
  foreach ($window in $AE::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $byPid)) {
    foreach ($button in $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $isButton)) {
      $name = $button.Current.Name
      if ($wanted -contains $name) {
        $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
        Write-Output "invoked:$name"
        exit 0
      }
    }
  }
  Start-Sleep -Milliseconds 300
}
Write-Output 'not-found'
exit 1
