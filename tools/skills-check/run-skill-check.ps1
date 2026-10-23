param([ValidateSet('skillscheck','skillsaw','skills-ref')][string]$Tool='skillscheck')
$ErrorActionPreference='Stop'
$Skill='C:\Users\abstract\.codex\skills\mmss-principle-synthesis'
$Out='D:\dev\personal\projects\mmss-skill-observatory\sourses-history\step1\RESULTS\s2\docs'
New-Item -ItemType Directory -Path $Out -Force | Out-Null
switch ($Tool) {
 'skillscheck' {
   $exe="$env:TEMP\mmss-skillscheck-venv\Scripts\skillscheck.exe"
   if (!(Test-Path $exe)) { throw 'skillscheck venv missing; install it separately first.' }
   & $exe $Skill --format json | Set-Content -Encoding utf8 "$Out\skillscheck-mmss-principle-synthesis.json"
 }
 'skillsaw' {
   $exe="$env:TEMP\s2-skillsaw-venv\Scripts\skillsaw.exe"
   if (!(Test-Path $exe)) { python -m venv "$env:TEMP\s2-skillsaw-venv"; & "$env:TEMP\s2-skillsaw-venv\Scripts\python.exe" -m pip install skillsaw | Out-Null }
   $text=& $exe lint $Skill --format json -v 2>&1
   $joined=$text -join "`n"; $json=$joined.Substring($joined.IndexOf('{'))
   Set-Content -Encoding utf8 "$Out\skillsaw-mmss-principle-synthesis.json" $json
 }
 'skills-ref' {
   $exe="$env:TEMP\s2-skills-ref-venv\Scripts\skills-ref.exe"
   if (!(Test-Path $exe)) { python -m venv "$env:TEMP\s2-skills-ref-venv"; & "$env:TEMP\s2-skills-ref-venv\Scripts\python.exe" -m pip install -e "$env:TEMP\s2-skills-ref\skills-ref" | Out-Null }
   & $exe validate $Skill 2>&1 | Set-Content -Encoding utf8 "$Out\skills-ref-mmss-principle-synthesis.txt"
 }
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
