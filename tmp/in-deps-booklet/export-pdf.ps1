param(
    [Parameter(Mandatory = $true)]
    [string]$InputPptx,

    [Parameter(Mandatory = $true)]
    [string]$OutputPdf
)

$presentation = $null
$powerPoint = $null

try {
    $sourcePath = [System.IO.Path]::GetFullPath($InputPptx)
    $targetPath = [System.IO.Path]::GetFullPath($OutputPdf)
    $targetDirectory = [System.IO.Path]::GetDirectoryName($targetPath)

    if (-not (Test-Path -LiteralPath $sourcePath)) {
        throw "PowerPoint source file not found: $sourcePath"
    }

    [System.IO.Directory]::CreateDirectory($targetDirectory) | Out-Null
    $powerPoint = New-Object -ComObject PowerPoint.Application
    $presentation = $powerPoint.Presentations.Open($sourcePath, -1, 0, 0)
    $presentation.SaveAs($targetPath, 32)
}
finally {
    if ($null -ne $presentation) {
        $presentation.Close()
        [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)
    }
    if ($null -ne $powerPoint) {
        $powerPoint.Quit()
        [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($powerPoint)
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
