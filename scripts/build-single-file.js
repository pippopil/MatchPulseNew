import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const TEMP_CJS = path.join(ROOT_DIR, '.tmp_matchpulse_bundle.cjs');

console.log('Building minified standalone CommonJS bundle for single-file launcher...');

execSync(
  `npx esbuild server.ts --bundle --platform=node --format=cjs --minify --outfile="${TEMP_CJS}"`,
  { cwd: ROOT_DIR, stdio: 'inherit' }
);

const rawBundle = fs.readFileSync(TEMP_CJS);
const compressed = zlib.gzipSync(rawBundle, { level: 9 });
const base64 = compressed.toString('base64');
fs.unlinkSync(TEMP_CJS);

// Wrap base64 into clean 120-char lines for git friendliness and fast reading
const wrappedLines = [];
for (let i = 0; i < base64.length; i += 120) {
  wrappedLines.push(base64.slice(i, i + 120));
}
const payloadBlock = wrappedLines.join('\r\n');

const batchHeader = [
  '@echo off',
  'setlocal EnableExtensions',
  'chcp 65001 >nul 2>&1',
  'title MatchPulse - Автономный запуск',
  'cd /d "%~dp0"',
  '',
  'echo ======================================================================',
  'echo          MatchPulse - Автономный футбольный аналитический парсер',
  'echo          Запуск одним файлом (без установки и лишних папок)',
  'echo ======================================================================',
  'echo.',
  '',
  ':: 1. Поиск Node.js на компьютере',
  'set "NODE_CMD="',
  'set "MP_CACHE_DIR=%LOCALAPPDATA%\\MatchPulse"',
  '',
  'where node.exe >nul 2>&1',
  'if not errorlevel 1 goto :SET_NODE_PATH',
  '',
  'where node >nul 2>&1',
  'if not errorlevel 1 goto :SET_NODE_PATH',
  '',
  'if exist "%ProgramFiles%\\nodejs\\node.exe" goto :SET_NODE_PF',
  'if exist "%ProgramFiles(x86)%\\nodejs\\node.exe" goto :SET_NODE_PF86',
  'if exist "%LocalAppData%\\Programs\\node\\node.exe" goto :SET_NODE_LOCAL',
  'if exist "%AppData%\\nvm\\current\\node.exe" goto :SET_NODE_NVM',
  'if exist "%MP_CACHE_DIR%\\node.exe" goto :SET_NODE_CACHE',
  'if exist "%~dp0bin\\node.exe" goto :SET_NODE_LEGACY',
  '',
  ':: Если Node.js не установлен — скачиваем официальный node.exe один раз в %LOCALAPPDATA%\\MatchPulse',
  'echo [1/2] Node.js не обнаружен на компьютере.',
  'echo Загрузка официального портативного node.exe (~35 МБ)...',
  'echo (Разовая операция, папка на рабочем столе не засоряется)',
  'echo.',
  '',
  'if not exist "%MP_CACHE_DIR%" mkdir "%MP_CACHE_DIR%"',
  '',
  'where curl.exe >nul 2>&1',
  'if not errorlevel 1 goto :DOWNLOAD_CURL',
  '',
  'where curl >nul 2>&1',
  'if not errorlevel 1 goto :DOWNLOAD_CURL',
  '',
  'where powershell.exe >nul 2>&1',
  'if not errorlevel 1 goto :DOWNLOAD_PS',
  '',
  'where powershell >nul 2>&1',
  'if not errorlevel 1 goto :DOWNLOAD_PS',
  '',
  'goto :DOWNLOAD_ERROR',
  '',
  ':DOWNLOAD_CURL',
  'curl.exe -# -fSL "https://nodejs.org/dist/v20.18.0/win-x64/node.exe" -o "%MP_CACHE_DIR%\\node.exe"',
  'goto :VERIFY_DOWNLOAD',
  '',
  ':DOWNLOAD_PS',
  'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile(\'https://nodejs.org/dist/v20.18.0/win-x64/node.exe\', \'%MP_CACHE_DIR%\\node.exe\')"',
  'goto :VERIFY_DOWNLOAD',
  '',
  ':VERIFY_DOWNLOAD',
  'if exist "%MP_CACHE_DIR%\\node.exe" goto :SET_NODE_CACHE',
  '',
  ':DOWNLOAD_ERROR',
  'echo.',
  'echo [ОШИБКА] Не удалось автоматически загрузить портативный node.exe.',
  'echo Установите Node.js (LTS) с сайта https://nodejs.org/ и запустите этот файл снова.',
  'echo.',
  'pause',
  'exit /b 1',
  '',
  ':SET_NODE_PATH',
  'set "NODE_CMD=node"',
  'goto :LAUNCH_APP',
  '',
  ':SET_NODE_PF',
  'set "NODE_CMD=%ProgramFiles%\\nodejs\\node.exe"',
  'goto :LAUNCH_APP',
  '',
  ':SET_NODE_PF86',
  'set "NODE_CMD=%ProgramFiles(x86)%\\nodejs\\node.exe"',
  'goto :LAUNCH_APP',
  '',
  ':SET_NODE_LOCAL',
  'set "NODE_CMD=%LocalAppData%\\Programs\\node\\node.exe"',
  'goto :LAUNCH_APP',
  '',
  ':SET_NODE_NVM',
  'set "NODE_CMD=%AppData%\\nvm\\current\\node.exe"',
  'goto :LAUNCH_APP',
  '',
  ':SET_NODE_CACHE',
  'set "NODE_CMD=%MP_CACHE_DIR%\\node.exe"',
  'goto :LAUNCH_APP',
  '',
  ':SET_NODE_LEGACY',
  'set "NODE_CMD=%~dp0bin\\node.exe"',
  'goto :LAUNCH_APP',
  '',
  ':LAUNCH_APP',
  'echo [OK] Запуск MatchPulse из одного файла...',
  'set "MP_SELF=%~f0"',
  'set "MATCHPULSE_OPEN_BROWSER=1"',
  '"%NODE_CMD%" -e "const f=require(\'fs\'),z=require(\'zlib\'),o=require(\'os\'),p=require(\'path\');const t=f.readFileSync(process.env.MP_SELF,\'utf8\');const k=\':::___MATCHPULSE_\'+\'PAYLOAD___:::\';const i=t.lastIndexOf(k);if(i===-1)throw new Error(\'Payload missing\');const b=t.slice(i+k.length).replace(/[^A-Za-z0-9+/=]/g,\'\');const d=p.join(o.tmpdir(),\'matchpulse_runtime.cjs\');f.writeFileSync(d,z.gunzipSync(Buffer.from(b,\'base64\')));require(d);"',
  '',
  'if errorlevel 1 goto :APP_ERROR',
  'echo.',
  'echo Сервер MatchPulse остановлен.',
  'pause',
  'exit /b 0',
  '',
  ':APP_ERROR',
  'echo.',
  'echo [ОШИБКА] Сервер завершил работу с ошибкой.',
  'pause',
  'exit /b 1',
  '',
  ':::___MATCHPULSE_PAYLOAD___:::',
].join('\r\n');

const fullFileContent = `${batchHeader}\r\n${payloadBlock}\r\n`;

const targets = ['MatchPulse.bat', 'start_windows.bat', 'Запуск_MatchPulse.bat'];
for (const filename of targets) {
  const dest = path.join(ROOT_DIR, filename);
  fs.writeFileSync(dest, fullFileContent, 'utf-8');
}

const kb = (Buffer.byteLength(fullFileContent, 'utf-8') / 1024).toFixed(1);
console.log(`[✓] Single-file standalone launcher generated (${kb} KB): ${targets.join(', ')}`);
