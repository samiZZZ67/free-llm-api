# The FreeLLMAPI Windows installer lives at https://github.com/samiZZZ67/free-llm-apiinstall.ps1
# This shim keeps old `iwr ... github.io ... | iex` one-liners working.
$ErrorActionPreference = 'Stop'
Invoke-Expression (Invoke-RestMethod -UseBasicParsing https://github.com/samiZZZ67/free-llm-apiinstall.ps1)
