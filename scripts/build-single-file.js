import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

function getDistFiles(dir, base = '') {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  for (const item of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, item);
    const relPath = base ? `${base}/${item}` : item;
    if (relPath === 'assets/aistudio' || relPath.startsWith('assets/aistudio/')) {
      continue;
    }
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(getDistFiles(fullPath, relPath));
    } else {
      results.push({ fullPath, relPath });
    }
  }
  return results;
}

console.log('Building Zero-Node.js standalone single-file Windows launcher (native PowerShell + .NET)...');

const distFiles = getDistFiles(DIST_DIR);
if (distFiles.length === 0) {
  throw new Error('dist/ directory is empty. Run vite build first.');
}

// Pack all frontend dist files into a simple TSV manifest and gzip-compress it
const manifestLines = [];
for (const f of distFiles) {
  const ext = path.extname(f.fullPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const rawBase64 = fs.readFileSync(f.fullPath).toString('base64');
  manifestLines.push(`${f.relPath}\t${contentType}\t${rawBase64}`);
}
const manifestBuf = Buffer.from(manifestLines.join('\n'), 'utf-8');
const compressedAssets = zlib.gzipSync(manifestBuf, { level: 9 }).toString('base64');

const wrappedAssets = [];
for (let i = 0; i < compressedAssets.length; i += 120) {
  wrappedAssets.push(compressedAssets.slice(i, i + 120));
}
const assetsPayloadBlock = wrappedAssets.join('\r\n');

// Pure C# 5 (.NET Framework 4.x compatible, ZERO external assemblies, ZERO Node.js, ZERO Admin required)
const csharpServerCode = `
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

public class MatchPulseNativeServer
{
    private class AssetEntry
    {
        public string ContentType;
        public byte[] Data;
    }

    private static Dictionary<string, AssetEntry> _assets = new Dictionary<string, AssetEntry>(StringComparer.OrdinalIgnoreCase);
    private static string _selfBatPath = "";
    private static readonly string[] AllowedHosts = new string[]
    {
        "global.flashscore.ninja",
        "prod-public-api.livescore.com",
        "site.api.espn.com"
    };

    public static void Start(string selfBatPath)
    {
        _selfBatPath = selfBatPath;

        try
        {
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | (SecurityProtocolType)768 | SecurityProtocolType.Tls;
        }
        catch { }
        ServicePointManager.DefaultConnectionLimit = 32;

        LoadEmbeddedAssets(selfBatPath);

        TcpListener listener = null;
        int port = 3000;
        for (int p = 3000; p <= 3030; p++)
        {
            try
            {
                TcpListener candidate = new TcpListener(IPAddress.Loopback, p);
                candidate.Start();
                listener = candidate;
                port = p;
                break;
            }
            catch
            {
            }
        }

        if (listener == null)
        {
            throw new Exception("Не удалось занять свободный порт в диапазоне 3000-3030.");
        }

        string url = "http://localhost:" + port.ToString();
        Console.WriteLine();
        Console.WriteLine("======================================================================");
        Console.WriteLine("   MatchPulse запущен без Node.js (встроенный движок Windows .NET)");
        Console.WriteLine("   Адрес в браузере: " + url);
        Console.WriteLine("   Для выхода просто закройте это окно.");
        Console.WriteLine("======================================================================");
        Console.WriteLine();

        try
        {
            ProcessStartInfo psi = new ProcessStartInfo(url);
            psi.UseShellExecute = true;
            Process.Start(psi);
        }
        catch { }

        while (true)
        {
            try
            {
                TcpClient client = listener.AcceptTcpClient();
                ThreadPool.QueueUserWorkItem(HandleClient, client);
            }
            catch
            {
                break;
            }
        }
    }

    private static void LoadEmbeddedAssets(string batPath)
    {
        string fullText = File.ReadAllText(batPath, Encoding.UTF8);
        string marker = ":::___MP_ASSETS_" + "START___:::";
        int idx = fullText.LastIndexOf(marker, StringComparison.Ordinal);
        if (idx < 0)
        {
            throw new Exception("Встроенные ресурсы приложения не найдены.");
        }

        string rawB64 = fullText.Substring(idx + marker.Length);
        StringBuilder sb = new StringBuilder(rawB64.Length);
        for (int i = 0; i < rawB64.Length; i++)
        {
            char c = rawB64[i];
            if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '+' || c == '/' || c == '=')
            {
                sb.Append(c);
            }
        }

        byte[] gzBytes = Convert.FromBase64String(sb.ToString());
        string manifest;
        using (MemoryStream ms = new MemoryStream(gzBytes))
        using (GZipStream gz = new GZipStream(ms, CompressionMode.Decompress))
        using (StreamReader sr = new StreamReader(gz, Encoding.UTF8))
        {
            manifest = sr.ReadToEnd();
        }

        string[] lines = manifest.Split(new char[] { '\\n' }, StringSplitOptions.RemoveEmptyEntries);
        foreach (string line in lines)
        {
            string[] parts = line.Trim().Split('\\t');
            if (parts.Length >= 3)
            {
                AssetEntry entry = new AssetEntry();
                entry.ContentType = parts[1];
                entry.Data = Convert.FromBase64String(parts[2]);
                _assets[parts[0]] = entry;
            }
        }
    }

    private static void HandleClient(object state)
    {
        TcpClient client = (TcpClient)state;
        try
        {
            client.ReceiveTimeout = 10000;
            client.SendTimeout = 15000;
            using (client)
            using (NetworkStream stream = client.GetStream())
            {
                string method;
                string rawTarget;
                string body;
                if (!ReadHttpRequest(stream, out method, out rawTarget, out body))
                {
                    return;
                }

                if (string.Equals(method, "OPTIONS", StringComparison.OrdinalIgnoreCase))
                {
                    SendResponse(stream, 204, "No Content", "text/plain", new byte[0], null);
                    return;
                }

                string pathPart = rawTarget;
                string queryPart = "";
                int qIdx = rawTarget.IndexOf('?');
                if (qIdx >= 0)
                {
                    pathPart = rawTarget.Substring(0, qIdx);
                    queryPart = rawTarget.Substring(qIdx + 1);
                }

                if (pathPart == "/api/ping")
                {
                    SendText(stream, 200, "OK", "text/plain; charset=utf-8", "pong");
                    return;
                }

                if (pathPart == "/api/matches")
                {
                    SendText(stream, 200, "OK", "application/json; charset=utf-8", "{\\"mode\\":\\"client-proxy\\"}");
                    return;
                }

                if (pathPart == "/api/proxy")
                {
                    HandleProxy(stream, queryPart);
                    return;
                }

                if (pathPart == "/api/telegram/send" && string.Equals(method, "POST", StringComparison.OrdinalIgnoreCase))
                {
                    HandleTelegram(stream, body);
                    return;
                }

                if (pathPart == "/api/download-launcher")
                {
                    if (!string.IsNullOrEmpty(_selfBatPath) && File.Exists(_selfBatPath))
                    {
                        byte[] batBytes = File.ReadAllBytes(_selfBatPath);
                        SendResponse(stream, 200, "OK", "application/octet-stream", batBytes, "Content-Disposition: attachment; filename=\\"MatchPulse.bat\\"");
                    }
                    else
                    {
                        SendText(stream, 404, "Not Found", "text/plain; charset=utf-8", "MatchPulse.bat not found");
                    }
                    return;
                }

                // Serve static assets from RAM or fallback to index.html for SPA
                string key = Uri.UnescapeDataString(pathPart).TrimStart('/');
                if (string.IsNullOrEmpty(key))
                {
                    key = "index.html";
                }

                AssetEntry asset;
                if (_assets.TryGetValue(key, out asset))
                {
                    string cacheHdr = key.EndsWith(".html", StringComparison.OrdinalIgnoreCase)
                        ? "Cache-Control: no-cache"
                        : "Cache-Control: public, max-age=31536000, immutable";
                    SendResponse(stream, 200, "OK", asset.ContentType, asset.Data, cacheHdr);
                    return;
                }

                if (_assets.TryGetValue("index.html", out asset))
                {
                    SendResponse(stream, 200, "OK", "text/html; charset=utf-8", asset.Data, "Cache-Control: no-cache");
                    return;
                }

                SendText(stream, 404, "Not Found", "text/plain; charset=utf-8", "Not Found");
            }
        }
        catch
        {
        }
    }

    private static void HandleProxy(NetworkStream stream, string queryPart)
    {
        string targetUrl = GetQueryParam(queryPart, "url");
        if (string.IsNullOrEmpty(targetUrl))
        {
            SendText(stream, 400, "Bad Request", "application/json; charset=utf-8", "{\\"error\\":\\"Missing url\\"}");
            return;
        }

        Uri uri;
        if (!Uri.TryCreate(targetUrl, UriKind.Absolute, out uri) || (uri.Scheme != "https" && uri.Scheme != "http"))
        {
            SendText(stream, 400, "Bad Request", "application/json; charset=utf-8", "{\\"error\\":\\"Invalid url\\"}");
            return;
        }

        bool allowed = false;
        for (int i = 0; i < AllowedHosts.Length; i++)
        {
            if (string.Equals(uri.Host, AllowedHosts[i], StringComparison.OrdinalIgnoreCase))
            {
                allowed = true;
                break;
            }
        }
        if (!allowed)
        {
            SendText(stream, 403, "Forbidden", "application/json; charset=utf-8", "{\\"error\\":\\"Host not allowed\\"}");
            return;
        }

        try
        {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(uri);
            req.Method = "GET";
            req.Timeout = 6000;
            req.ReadWriteTimeout = 6000;
            req.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            req.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
            if (string.Equals(uri.Host, "global.flashscore.ninja", StringComparison.OrdinalIgnoreCase))
            {
                req.Headers["x-fsign"] = "SW9D1eZo";
            }

            using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
            using (Stream respStream = resp.GetResponseStream())
            using (MemoryStream ms = new MemoryStream())
            {
                respStream.CopyTo(ms);
                string ct = string.IsNullOrEmpty(resp.ContentType) ? "text/plain; charset=utf-8" : resp.ContentType;
                SendResponse(stream, (int)resp.StatusCode, "OK", ct, ms.ToArray(), "Cache-Control: no-cache");
            }
        }
        catch (Exception ex)
        {
            SendText(stream, 502, "Bad Gateway", "application/json; charset=utf-8", "{\\"error\\":\\"" + EscapeJson(ex.Message) + "\\"}");
        }
    }

    private static void HandleTelegram(NetworkStream stream, string body)
    {
        try
        {
            string token = ExtractJsonString(body, "token");
            string chatId = ExtractJsonString(body, "chatId");
            string text = ExtractJsonString(body, "text");

            if (string.IsNullOrEmpty(token) || string.IsNullOrEmpty(chatId) || string.IsNullOrEmpty(text))
            {
                SendText(stream, 400, "Bad Request", "application/json; charset=utf-8", "{\\"ok\\":false,\\"description\\":\\"Missing fields\\"}");
                return;
            }

            string payload = "{\\"chat_id\\":\\"" + EscapeJson(chatId) + "\\",\\"text\\":\\"" + EscapeJson(text) + "\\",\\"parse_mode\\":\\"HTML\\",\\"disable_web_page_preview\\":true}";
            byte[] payloadBytes = Encoding.UTF8.GetBytes(payload);

            HttpWebRequest req = (HttpWebRequest)WebRequest.Create("https://api.telegram.org/bot" + token + "/sendMessage");
            req.Method = "POST";
            req.ContentType = "application/json; charset=utf-8";
            req.ContentLength = payloadBytes.Length;
            req.Timeout = 8000;
            using (Stream reqStream = req.GetRequestStream())
            {
                reqStream.Write(payloadBytes, 0, payloadBytes.Length);
            }

            using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
            using (Stream respStream = resp.GetResponseStream())
            using (MemoryStream ms = new MemoryStream())
            {
                respStream.CopyTo(ms);
                SendResponse(stream, 200, "OK", "application/json; charset=utf-8", ms.ToArray(), null);
            }
        }
        catch (Exception ex)
        {
            SendText(stream, 500, "Internal Server Error", "application/json; charset=utf-8", "{\\"ok\\":false,\\"description\\":\\"" + EscapeJson(ex.Message) + "\\"}");
        }
    }

    private static bool ReadHttpRequest(NetworkStream stream, out string method, out string target, out string body)
    {
        method = "";
        target = "/";
        body = "";

        MemoryStream ms = new MemoryStream();
        byte[] buf = new byte[4096];
        int headerEnd = -1;
        while (ms.Length < 65536)
        {
            int n = stream.Read(buf, 0, buf.Length);
            if (n <= 0) break;
            ms.Write(buf, 0, n);
            byte[] arr = ms.ToArray();
            headerEnd = FindHeaderEnd(arr);
            if (headerEnd >= 0) break;
        }

        if (headerEnd < 0) return false;

        byte[] all = ms.ToArray();
        string headerText = Encoding.ASCII.GetString(all, 0, headerEnd);
        string[] lines = headerText.Split(new string[] { "\\r\\n" }, StringSplitOptions.None);
        if (lines.Length == 0) return false;

        string[] first = lines[0].Split(' ');
        if (first.Length < 2) return false;
        method = first[0];
        target = first[1];

        int contentLength = 0;
        for (int i = 1; i < lines.Length; i++)
        {
            if (lines[i].StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase))
            {
                int parsed;
                if (int.TryParse(lines[i].Substring(15).Trim(), out parsed) && parsed > 0)
                {
                    contentLength = parsed;
                }
            }
        }

        if (contentLength > 0 && contentLength <= 1048576)
        {
            int bodyStart = headerEnd + 4;
            int alreadyRead = all.Length - bodyStart;
            byte[] bodyBytes = new byte[contentLength];
            int copied = Math.Min(alreadyRead, contentLength);
            if (copied > 0)
            {
                Buffer.BlockCopy(all, bodyStart, bodyBytes, 0, copied);
            }
            while (copied < contentLength)
            {
                int n = stream.Read(bodyBytes, copied, contentLength - copied);
                if (n <= 0) break;
                copied += n;
            }
            body = Encoding.UTF8.GetString(bodyBytes, 0, copied);
        }

        return true;
    }

    private static int FindHeaderEnd(byte[] arr)
    {
        for (int i = 0; i <= arr.Length - 4; i++)
        {
            if (arr[i] == 13 && arr[i + 1] == 10 && arr[i + 2] == 13 && arr[i + 3] == 10)
            {
                return i;
            }
        }
        return -1;
    }

    private static string GetQueryParam(string query, string name)
    {
        if (string.IsNullOrEmpty(query)) return "";
        string[] pairs = query.Split('&');
        foreach (string pair in pairs)
        {
            int eq = pair.IndexOf('=');
            if (eq > 0)
            {
                string k = Uri.UnescapeDataString(pair.Substring(0, eq).Replace("+", " "));
                if (string.Equals(k, name, StringComparison.OrdinalIgnoreCase))
                {
                    return Uri.UnescapeDataString(pair.Substring(eq + 1).Replace("+", " "));
                }
            }
        }
        return "";
    }

    private static string ExtractJsonString(string json, string key)
    {
        if (string.IsNullOrEmpty(json)) return "";
        string pattern = "\\"" + key + "\\"";
        int idx = json.IndexOf(pattern, StringComparison.Ordinal);
        if (idx < 0) return "";
        int colon = json.IndexOf(':', idx + pattern.Length);
        if (colon < 0) return "";
        int startQuote = json.IndexOf('"', colon + 1);
        if (startQuote < 0) return "";

        StringBuilder sb = new StringBuilder();
        for (int i = startQuote + 1; i < json.Length; i++)
        {
            char c = json[i];
            if (c == '\\\\' && i + 1 < json.Length)
            {
                char next = json[++i];
                if (next == 'n') sb.Append('\\n');
                else if (next == 'r') sb.Append('\\r');
                else if (next == 't') sb.Append('\\t');
                else if (next == 'u' && i + 4 < json.Length)
                {
                    string hex = json.Substring(i + 1, 4);
                    int code;
                    if (int.TryParse(hex, System.Globalization.NumberStyles.HexNumber, null, out code))
                    {
                        sb.Append((char)code);
                        i += 4;
                    }
                }
                else sb.Append(next);
            }
            else if (c == '"')
            {
                break;
            }
            else
            {
                sb.Append(c);
            }
        }
        return sb.ToString();
    }

    private static string EscapeJson(string s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        StringBuilder sb = new StringBuilder(s.Length + 16);
        for (int i = 0; i < s.Length; i++)
        {
            char c = s[i];
            if (c == '\\\\') sb.Append("\\\\\\\\");
            else if (c == '"') sb.Append("\\\\\\\"");
            else if (c == '\\n') sb.Append("\\\\n");
            else if (c == '\\r') sb.Append("\\\\r");
            else if (c == '\\t') sb.Append("\\\\t");
            else sb.Append(c);
        }
        return sb.ToString();
    }

    private static void SendText(NetworkStream stream, int code, string reason, string contentType, string text)
    {
        SendResponse(stream, code, reason, contentType, Encoding.UTF8.GetBytes(text), null);
    }

    private static void SendResponse(NetworkStream stream, int code, string reason, string contentType, byte[] data, string extraHeader)
    {
        StringBuilder sb = new StringBuilder();
        sb.Append("HTTP/1.1 ").Append(code).Append(' ').Append(reason).Append("\\r\\n");
        sb.Append("Content-Type: ").Append(contentType).Append("\\r\\n");
        sb.Append("Content-Length: ").Append(data.Length).Append("\\r\\n");
        sb.Append("Access-Control-Allow-Origin: *\\r\\n");
        sb.Append("Access-Control-Allow-Methods: GET, POST, OPTIONS\\r\\n");
        sb.Append("Access-Control-Allow-Headers: Content-Type\\r\\n");
        if (!string.IsNullOrEmpty(extraHeader))
        {
            sb.Append(extraHeader).Append("\\r\\n");
        }
        sb.Append("Connection: close\\r\\n\\r\\n");

        byte[] headerBytes = Encoding.ASCII.GetBytes(sb.ToString());
        stream.Write(headerBytes, 0, headerBytes.Length);
        if (data.Length > 0)
        {
            stream.Write(data, 0, data.Length);
        }
        stream.Flush();
    }
}
`;

// PowerShell host block embedded inside the .bat file
const psHostScript = [
  `$ErrorActionPreference = 'Stop'`,
  `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`,
  `$code = @'`,
  csharpServerCode.trim(),
  `'@`,
  `Add-Type -TypeDefinition $code -Language CSharp`,
  `[MatchPulseNativeServer]::Start($env:MP_SELF)`
].join('\r\n');

const batchHeader = [
  '@echo off',
  'setlocal EnableExtensions',
  'chcp 65001 >nul 2>&1',
  'title MatchPulse - Автономный запуск (без Node.js)',
  'cd /d "%~dp0"',
  '',
  'echo ======================================================================',
  'echo          MatchPulse - Автономный футбольный аналитический парсер',
  'echo          Запуск одним файлом без Node.js и без установки',
  'echo ======================================================================',
  'echo.',
  'echo [1/1] Инициализация встроенного локального сервера Windows...',
  '',
  'set "MP_SELF=%~f0"',
  'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:MP_SELF,[Text.Encoding]::UTF8);$m=\':::___MP_PS_\'+\'START___:::\';$e=\':::___MP_PS_\'+\'END___:::\';$a=$t.LastIndexOf($m);$b=$t.LastIndexOf($e);if($a -lt 0 -or $b -le $a){throw \'Payload corrupted\'};$s=$t.Substring($a+$m.Length,$b-$a-$m.Length);Invoke-Expression $s"',
  '',
  'if errorlevel 1 goto :APP_ERROR',
  'echo.',
  'echo Сервер MatchPulse остановлен.',
  'pause',
  'exit /b 0',
  '',
  ':APP_ERROR',
  'echo.',
  'echo [ОШИБКА] Не удалось запустить встроенный сервер.',
  'echo Убедитесь, что используется Windows 10/11 и PowerShell доступен.',
  'pause',
  'exit /b 1',
  '',
  ':::___MP_PS_START___:::',
  psHostScript,
  ':::___MP_PS_END___:::',
  ':::___MP_ASSETS_START___:::',
  assetsPayloadBlock,
  ''
].join('\r\n');

const normalizedBatch = batchHeader.replace(/\r?\n/g, '\r\n');

const targets = ['MatchPulse.bat', 'start_windows.bat', 'Запуск_MatchPulse.bat'];
for (const filename of targets) {
  fs.writeFileSync(path.join(ROOT_DIR, filename), normalizedBatch, 'utf-8');
}

const kb = (Buffer.byteLength(normalizedBatch, 'utf-8') / 1024).toFixed(1);
console.log(`[✓] Zero-Node.js single-file Windows launcher generated (${kb} KB): ${targets.join(', ')}`);
