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

