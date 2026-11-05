# Regenerates extension/icons/*.png (rounded gradient tile, play button, sparkle).
# Usage (Windows PowerShell): powershell -ExecutionPolicy Bypass -File scripts/make-icons.ps1
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot '..\extension\icons'
New-Item -ItemType Directory -Force $outDir | Out-Null

foreach ($size in 16, 32, 48, 128) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    # Rounded square with a blue-to-violet gradient.
    $r = [single]($size * 0.22)
    $d = 2 * $r
    $s = [single]($size - 1)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($s - $d, 0, $d, $d, 270, 90)
    $path.AddArc($s - $d, $s - $d, $d, $d, 0, 90)
    $path.AddArc(0, $s - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $rect = New-Object System.Drawing.RectangleF 0, 0, $size, $size
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, `
        ([System.Drawing.Color]::FromArgb(255, 59, 91, 219)), `
        ([System.Drawing.Color]::FromArgb(255, 132, 94, 247)), 45
    $g.FillPath($brush, $path)

    # Play triangle.
    $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $tri = [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF ([single]($size * 0.30)), ([single]($size * 0.24))),
        (New-Object System.Drawing.PointF ([single]($size * 0.30)), ([single]($size * 0.76))),
        (New-Object System.Drawing.PointF ([single]($size * 0.74)), ([single]($size * 0.50)))
    )
    $g.FillPolygon($white, $tri)

    # Four-point sparkle in the top-right corner (skipped at 16px where it would be mush).
    if ($size -ge 32) {
        $cx = $size * 0.79; $cy = $size * 0.21; $big = $size * 0.15; $small = $size * 0.04
        $spark = [System.Drawing.PointF[]]@(
            (New-Object System.Drawing.PointF ([single]$cx), ([single]($cy - $big))),
            (New-Object System.Drawing.PointF ([single]($cx + $small)), ([single]($cy - $small))),
            (New-Object System.Drawing.PointF ([single]($cx + $big)), ([single]$cy)),
            (New-Object System.Drawing.PointF ([single]($cx + $small)), ([single]($cy + $small))),
            (New-Object System.Drawing.PointF ([single]$cx), ([single]($cy + $big))),
            (New-Object System.Drawing.PointF ([single]($cx - $small)), ([single]($cy + $small))),
            (New-Object System.Drawing.PointF ([single]($cx - $big)), ([single]$cy)),
            (New-Object System.Drawing.PointF ([single]($cx - $small)), ([single]($cy - $small)))
        )
        $g.FillPolygon((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 224, 102))), $spark)
    }

    $file = Join-Path $outDir "icon$size.png"
    $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Output "Wrote $file"
}
