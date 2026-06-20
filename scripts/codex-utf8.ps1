$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

[Console]::InputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

try {
    chcp.com 65001 | Out-Null
} catch {
    # chcp is best-effort. Console/Text encodings above are the important part.
}
