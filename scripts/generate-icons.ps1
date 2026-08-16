# Generate TapLedger app icons (no white edge)
# Design: solid indigo background + white yen symbol (fills canvas, no rounded card)
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root "assets"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$size = 1024
$indigo = [System.Drawing.Color]::FromArgb(255, 121, 134, 203)  # #7986CB indigo
$white = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)

function New-Canvas($transparent, $fillColor) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    if ($transparent) {
        $g.Clear([System.Drawing.Color]::Transparent)
    } else {
        $g.Clear($fillColor)
    }
    return @($bmp, $g)
}

function Draw-Yen($g, $color) {
    $font = [System.Drawing.Font]::new("Segoe UI", 520, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $brush = [System.Drawing.SolidBrush]::new($color)
    $sf = [System.Drawing.StringFormat]::new()
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF(0, -20, $size, $size)
    $g.DrawString([char]0x00A5, $font, $brush, $rect, $sf)
    $brush.Dispose()
    $font.Dispose()
    $sf.Dispose()
}

function Save-Png($bmp, $g, $path) {
    $g.Dispose()
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "saved: $path"
}

# 1. icon.png: solid indigo + white yen
$c = New-Canvas $false $indigo
Draw-Yen $c[1] $white
Save-Png $c[0] $c[1] (Join-Path $dir "icon.png")

# 2. android-icon-foreground.png: transparent + white yen
$c = New-Canvas $true $indigo
Draw-Yen $c[1] $white
Save-Png $c[0] $c[1] (Join-Path $dir "android-icon-foreground.png")

# 3. android-icon-background.png: solid indigo
$c = New-Canvas $false $indigo
Save-Png $c[0] $c[1] (Join-Path $dir "android-icon-background.png")

# 4. android-icon-monochrome.png: transparent + white yen
$c = New-Canvas $true $indigo
Draw-Yen $c[1] $white
Save-Png $c[0] $c[1] (Join-Path $dir "android-icon-monochrome.png")

# 5. favicon.png
$bmp = New-Object System.Drawing.Bitmap((Join-Path $dir "icon.png"))
$fav = New-Object System.Drawing.Bitmap(48, 48)
$g = [System.Drawing.Graphics]::FromImage($fav)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($bmp, 0, 0, 48, 48)
$g.Dispose()
$fav.Save((Join-Path $dir "favicon.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$fav.Dispose()
$bmp.Dispose()
Write-Host "saved favicon.png"

