# Register a fixed per-user launch command. Nothing from the clicked URI is passed to it.
param([ValidateRange(1,65528)][int]$Port = 8590, [switch]$Remove)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).ProviderPath
$key = 'HKCU:\Software\Classes\eaw-universal'
if (Test-Path -LiteralPath $key) {
    if ((Get-Item -LiteralPath $key).GetValue('EaWUniversalCheckout') -ne $root) {
        throw 'This URL scheme is registered elsewhere. No changes were made.'
    }
    if ($Remove) {
        Remove-Item -LiteralPath $key -Recurse
        Write-Output 'Universal launch link removed. No game or save was changed.'
        return
    }
} elseif ($Remove) { return }
$node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
$server = Join-Path $root 'server.mjs'
if (-not (Test-Path -LiteralPath $server) -or ($node + $server).Contains('%')) { throw 'Unsupported launch path.' }
# Use absolute paths, no shell, no %1 placeholder, no URL-selected port, file or argument.
$command = '"{0}" "{1}" --universal --open --port {2}' -f $node, $server, $Port
New-Item "$key\shell\open\command" -Force | Out-Null
Set-Item -LiteralPath $key -Value 'URL:Empire War Remastered Universal'
New-ItemProperty -LiteralPath $key -Name 'EaWUniversalCheckout' -Value $root -Force | Out-Null
New-ItemProperty -LiteralPath $key -Name 'URL Protocol' -Value '' -Force | Out-Null
Set-Item -LiteralPath "$key\shell\open\command" -Value $command
Write-Output "Registered eaw-universal://play for this user -> http://127.0.0.1:$Port/"
