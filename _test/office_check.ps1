$ErrorActionPreference = 'Continue'
$dir = 'C:\Users\Administrator\WorkBuddy\2026-11-16-19-18-26\pdf-studio\_test\out'
$res = @()

# ---- Word ----
$word = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    foreach ($f in @('scan.docx', 'scan_图片版.docx', 'test-a.docx')) {
        $p = Join-Path $dir $f
        if (-not (Test-Path $p)) { $res += "$f : MISSING"; continue }
        try {
            $doc = $word.Documents.Open($p, $false, $true)
            $paras = $doc.Paragraphs.Count
            $shapes = $doc.InlineShapes.Count
            $first = ''
            if ($paras -gt 0) { $first = $doc.Paragraphs.Item(1).Range.Text.Trim() }
            $res += ("$f : OPEN OK paras=$paras shapes=$shapes first=" + $first.Substring(0, [Math]::Min(40, $first.Length)))
            $doc.Close($false)
        } catch {
            $res += "$f : FAIL " + $_.Exception.Message
        }
    }
    $word.Quit()
} catch {
    $res += "Word COM unavailable: " + $_.Exception.Message
}

# ---- Excel ----
try {
    $xl = New-Object -ComObject Excel.Application
    $xl.Visible = $false
    $xl.DisplayAlerts = $false
    $p = Join-Path $dir 'scan.xlsx'
    $wb = $xl.Workbooks.Open($p)
    $ws = $wb.Worksheets.Item(1)
    $ur = $ws.UsedRange
    $a1 = ''
    try { $a1 = [string]$ws.Cells.Item(1, 1).Value2 } catch {}
    $res += ("scan.xlsx : OPEN OK sheets=" + $wb.Worksheets.Count + " rows=" + $ur.Rows.Count + " cols=" + $ur.Columns.Count + " A1=" + $a1)
    $wb.Close($false)
    $xl.Quit()
} catch {
    $res += "scan.xlsx : FAIL " + $_.Exception.Message
}

# ---- PowerPoint ----
try {
    $pp = New-Object -ComObject PowerPoint.Application
    $p = Join-Path $dir 'scan.pptx'
    $pres = $pp.Presentations.Open($p, $true, $false, $false)
    $n = $pres.Slides.Count
    $txt = ''
    try { $txt = $pres.Slides.Item(1).Shapes.Item(1).TextFrame.TextRange.Text } catch {}
    $res += ("scan.pptx : OPEN OK slides=" + $n + " text=" + $txt.Substring(0, [Math]::Min(30, $txt.Length)))
    $pres.Close()
    $pp.Quit()
} catch {
    $res += "scan.pptx : FAIL " + $_.Exception.Message
}

$res -join "`r`n" | Set-Content -Encoding UTF8 (Join-Path $dir 'office-check.txt')
