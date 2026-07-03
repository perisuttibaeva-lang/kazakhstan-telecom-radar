param(
  [int]$Port = 3001,
  [switch]$UpdateOnce
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = Join-Path $Root "data"
$ArchiveFile = Join-Path $DataDir "archive.json"
$RecentDays = 45

$Sources = @(
  @{ name = "Тарифы операторов Казахстана"; type = "Google News RSS"; query = 'Казахстан мобильный оператор тариф OR абонентская плата OR "мобильный интернет"' },
  @{ name = "Beeline Казахстан"; type = "Google News RSS"; query = 'Beeline Казахстан тариф OR связь OR 5G OR "абонентская плата"' },
  @{ name = "Kcell и Activ"; type = "Google News RSS"; query = 'Kcell OR Activ Казахстан тариф OR связь OR 5G' },
  @{ name = "Tele2 и Altel"; type = "Google News RSS"; query = 'Tele2 OR Altel Казахстан тариф OR связь OR 5G' },
  @{ name = "Казахтелеком"; type = "Google News RSS"; query = 'Казахтелеком тариф OR интернет OR связь OR 5G' },
  @{ name = "Регуляторика телеком Казахстан"; type = "Google News RSS"; query = 'Казахстан телеком оператор штраф OR проверка OR антимонопольный OR регулятор' }
)

$Operators = @(
  @{ name = "Beeline"; tokens = @("beeline", "билайн", "кар-тел", "картел") },
  @{ name = "Kcell / Activ"; tokens = @("kcell", "кселл", "activ", "актив") },
  @{ name = "Tele2"; tokens = @("tele2", "теле2") },
  @{ name = "Altel"; tokens = @("altel", "алтел") },
  @{ name = "Казахтелеком"; tokens = @("казахтелеком", "kazakhtelecom") },
  @{ name = "Jusan Mobile"; tokens = @("jusan mobile", "жусан мобайл") }
)

$Topics = @(
  @{ name = "Тарифы"; tokens = @("тариф", "абонентск", "подорож", "цена", "стоимост", "пакет", "роуминг", "безлимит") },
  @{ name = "Регуляторика"; tokens = @("штраф", "провер", "антимонополь", "регулятор", "министерств", "лицензи", "качество связи") },
  @{ name = "Инфраструктура"; tokens = @("5g", "4g", "базов", "сеть", "инфраструктур", "покрыти", "интернет") },
  @{ name = "Акции"; tokens = @("акци", "промо", "скидк", "бонус", "предложени") },
  @{ name = "Рынок"; tokens = @("сделк", "партнер", "выручк", "абонент", "рынок", "отчет", "продаж") }
)

$HighImportance = @("повыш", "подорож", "изменил тариф", "абонентская плата", "штраф", "провер", "антимонополь", "регулятор", "сделк", "5g")
$MediumImportance = @("тариф", "роуминг", "запуст", "интернет", "партнер", "акци", "качество")
$RelevantTokens = @("beeline", "билайн", "kcell", "кселл", "activ", "актив", "tele2", "теле2", "altel", "алтел", "казахтелеком", "kazakhtelecom", "связ", "сотов", "телеком", "оператор", "тариф", "абонент", "мобильный интернет", "5g", "4g", "базов", "провайдер")

function Ensure-Archive {
  if (!(Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir | Out-Null
  }
  if (!(Test-Path $ArchiveFile)) {
    @{ meta = @{ lastRun = $null; total = 0 }; items = @() } |
      ConvertTo-Json -Depth 20 |
      Set-Content -Path $ArchiveFile -Encoding UTF8
  }
}

function Read-Archive {
  Ensure-Archive
  $raw = Get-Content -Path $ArchiveFile -Raw -Encoding UTF8
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return @{ meta = @{ lastRun = $null; total = 0 }; items = @() }
  }
  return $raw | ConvertFrom-Json
}

function Write-JsonResponse($Context, [int]$Status, $Payload) {
  $json = $Payload | ConvertTo-Json -Depth 30
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $Context.Response.StatusCode = $Status
  $Context.Response.ContentType = "application/json; charset=utf-8"
  $Context.Response.Headers.Add("Access-Control-Allow-Origin", "*")
  $Context.Response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  $Context.Response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
  $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $Context.Response.Close()
}

function Write-TextResponse($Context, [int]$Status, [string]$Text) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
  $Context.Response.StatusCode = $Status
  $Context.Response.ContentType = "text/plain; charset=utf-8"
  $Context.Response.Headers.Add("Access-Control-Allow-Origin", "*")
  $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $Context.Response.Close()
}

function Get-Mime([string]$Path) {
  switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    ".html" { "text/html; charset=utf-8" }
    ".css" { "text/css; charset=utf-8" }
    ".js" { "application/javascript; charset=utf-8" }
    ".json" { "application/json; charset=utf-8" }
    ".png" { "image/png" }
    ".jpg" { "image/jpeg" }
    default { "application/octet-stream" }
  }
}

function Contains-Any([string]$Text, [array]$Tokens) {
  foreach ($token in $Tokens) {
    if ($Text.Contains($token)) { return $true }
  }
  return $false
}

function Detect-Operator([string]$Text) {
  foreach ($operator in $Operators) {
    if (Contains-Any $Text $operator.tokens) { return $operator.name }
  }
  return "Рынок Казахстана"
}

function Detect-Topic([string]$Text) {
  foreach ($topic in $Topics) {
    if (Contains-Any $Text $topic.tokens) { return $topic.name }
  }
  return "Другое"
}

function Detect-Importance([string]$Text, [string]$Topic) {
  if (Contains-Any $Text $HighImportance) { return "high" }
  if ($Topic -eq "Тарифы" -or $Topic -eq "Регуляторика") { return "high" }
  if (Contains-Any $Text $MediumImportance) { return "medium" }
  return "low"
}

function Test-Relevant([string]$Text) {
  return Contains-Any $Text $RelevantTokens
}

function Get-StableId([string]$Value) {
  $md5 = [System.Security.Cryptography.MD5]::Create()
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
  $hash = $md5.ComputeHash($bytes)
  return "n_" + ([System.BitConverter]::ToString($hash).Replace("-", "").ToLowerInvariant())
}

function Get-GoogleNewsItems($Source) {
  $encoded = [System.Web.HttpUtility]::UrlEncode("$($Source.query) when:$($RecentDays)d")
  $url = "https://news.google.com/rss/search?q=$encoded&hl=ru&gl=KZ&ceid=KZ:ru"
  [xml]$xml = Invoke-WebRequest -Uri $url -UseBasicParsing -Headers @{ "User-Agent" = "Mozilla/5.0 TelecomRadar/1.0" } | Select-Object -ExpandProperty Content
  $items = @()

  foreach ($item in $xml.rss.channel.item) {
    $title = [string]$item.title
    $link = [string]$item.link
    if ([string]::IsNullOrWhiteSpace($title) -or [string]::IsNullOrWhiteSpace($link)) { continue }

    $pub = Get-Date
    if ($item.pubDate) {
      try { $pub = [datetime]::Parse([string]$item.pubDate) } catch { $pub = Get-Date }
    }
    if ($pub -lt (Get-Date).AddDays(-$RecentDays)) { continue }

    $sourceName = "Google News"
    if ($item.source -and $item.source."#text") {
      $sourceName = [string]$item.source."#text"
    }

    $description = ""
    if ($item.description) {
      $description = ([string]$item.description) -replace "<[^>]+>", " "
    }

    $text = "$title $description".ToLowerInvariant()
    if (!(Test-Relevant $text)) { continue }
    $operator = Detect-Operator $text
    $topic = Detect-Topic $text
    if ($operator -eq "Рынок Казахстана" -and $topic -eq "Другое") { continue }
    $importance = Detect-Importance $text $topic
    $id = Get-StableId "$title|$sourceName|$($pub.ToString("o"))"
    $prefix = if ($importance -eq "high") { "Важный сигнал" } else { "Новость" }

    $items += [pscustomobject]@{
      id = $id
      title = $title
      summary = "$prefix`: $operator, тема `"$topic`". Проверьте источник: $title"
      link = $link
      source = $sourceName
      sourceQuery = $Source.name
      operator = $operator
      topic = $topic
      importance = $importance
      publishedAt = $pub.ToUniversalTime().ToString("o")
      savedAt = (Get-Date).ToUniversalTime().ToString("o")
    }
  }

  return $items
}

function Refresh-News {
  Ensure-Archive
  $archive = Read-Archive
  $byId = @{}
  foreach ($item in @($archive.items)) {
    $itemText = "$($item.title) $($item.summary) $($item.operator) $($item.topic)".ToLowerInvariant()
    if ($item.id -and $item.publishedAt -and ([datetime]$item.publishedAt) -ge (Get-Date).AddDays(-$RecentDays) -and (Test-Relevant $itemText)) {
      $byId[$item.id] = $item
    }
  }

  $added = 0
  foreach ($source in $Sources) {
    try {
      foreach ($item in Get-GoogleNewsItems $source) {
        if (!$byId.ContainsKey($item.id)) {
          $byId[$item.id] = $item
          $added += 1
        }
      }
    } catch {
      Write-Host "Источник не ответил: $($source.name) — $($_.Exception.Message)"
    }
  }

  $items = @($byId.Values) |
    Sort-Object { if ($_.publishedAt) { [datetime]$_.publishedAt } else { [datetime]::MinValue } } -Descending |
    Select-Object -First 500

  $nextArchive = @{
    meta = @{ lastRun = (Get-Date).ToUniversalTime().ToString("o"); total = @($items).Count }
    items = @($items)
  }

  $nextArchive | ConvertTo-Json -Depth 30 | Set-Content -Path $ArchiveFile -Encoding UTF8

  return @{
    added = $added
    items = @($items)
    meta = $nextArchive.meta
    sources = $Sources
  }
}

function Serve-Static($Context, [string]$UrlPath) {
  $relative = if ($UrlPath -eq "/") { "index.html" } else { $UrlPath.TrimStart("/") }
  $filePath = [System.IO.Path]::GetFullPath((Join-Path $Root $relative))
  $rootPath = [System.IO.Path]::GetFullPath($Root)

  if (!$filePath.StartsWith($rootPath)) {
    Write-TextResponse $Context 403 "Forbidden"
    return
  }

  if (!(Test-Path $filePath -PathType Leaf)) {
    Write-TextResponse $Context 404 "Not found"
    return
  }

  $bytes = [System.IO.File]::ReadAllBytes($filePath)
  $Context.Response.StatusCode = 200
  $Context.Response.ContentType = Get-Mime $filePath
  $Context.Response.Headers.Add("Access-Control-Allow-Origin", "*")
  $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $Context.Response.Close()
}

Ensure-Archive

if ($UpdateOnce) {
  $result = Refresh-News
  Write-Host "Архив обновлен. Всего карточек: $($result.meta.total). Новых: $($result.added)."
  exit 0
}

$listener = [System.Net.HttpListener]::new()
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)
$listener.Start()

Write-Host "Телеком-радар запущен: $prefix"
Write-Host "Откройте этот адрес в браузере. Для остановки нажмите Ctrl+C."

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $path = $context.Request.Url.AbsolutePath
    $method = $context.Request.HttpMethod

    try {
      if ($method -eq "OPTIONS") {
        Write-JsonResponse $context 200 @{ ok = $true }
      } elseif ($path -eq "/api/news" -and $method -eq "GET") {
        $archive = Read-Archive
        Write-JsonResponse $context 200 @{ items = @($archive.items); meta = $archive.meta; sources = $Sources }
      } elseif ($path -eq "/api/refresh" -and $method -eq "POST") {
        Write-JsonResponse $context 200 (Refresh-News)
      } elseif ($path -eq "/api/sources" -and $method -eq "GET") {
        Write-JsonResponse $context 200 @{ sources = $Sources }
      } else {
        Serve-Static $context $path
      }
    } catch {
      Write-JsonResponse $context 500 @{ error = "Ошибка сервера"; detail = $_.Exception.Message }
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}




