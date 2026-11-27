# Dayfilm capture helper: writes one JSON line to stdout every ~2s.
# Keep this file ASCII-only. Windows PowerShell 5.1 reads .ps1 files as ANSI
# unless they carry a BOM, so non-ASCII source text can break parsing.
# Protocol (one line per snapshot):
#   {"ok":true,"title":"...","exe":"Code","idleMs":1200}
#   {"ok":false,"error":"..."}
# Exits on its own when the parent dies or when stdout is gone, so a crashed
# host never leaves an orphan sampling loop behind.
param(
  # Parent process to watch. 0 disables the check, for manual debugging.
  [int]$ParentPid = 0
)

$ErrorActionPreference = 'Continue'

try {
  # Titles are mostly non-ASCII; force UTF-8 on the redirected stdout stream.
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch {
  # Keep the default encoding; captions may degrade to ANSI.
}

$source = @'
using System;
using System.Text;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class DayfilmCapture
{
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int pid);

    [DllImport("user32.dll")]
    public static extern bool GetLastInputInfo(ref LASTINPUTINFO info);

    [DllImport("kernel32.dll")]
    public static extern ulong GetTickCount64();

    [StructLayout(LayoutKind.Sequential)]
    public struct LASTINPUTINFO
    {
        public uint cbSize;
        public uint dwTime;
    }

    private static long IdleMs()
    {
        LASTINPUTINFO info = new LASTINPUTINFO();
        info.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
        if (!GetLastInputInfo(ref info)) return 0;
        // GetTickCount64 is 64-bit while dwTime wraps at 2^32; the unsigned
        // difference restores the delta as long as the idle span is < 49 days.
        return (long)(uint)((uint)GetTickCount64() - info.dwTime);
    }

    private static void Escape(StringBuilder target, string text)
    {
        for (int i = 0; i < text.Length; i++)
        {
            char c = text[i];
            switch (c)
            {
                case '\\': target.Append("\\\\"); break;
                case '"': target.Append("\\\""); break;
                case '\n': target.Append("\\n"); break;
                case '\r': target.Append("\\r"); break;
                case '\t': target.Append("\\t"); break;
                default:
                    if (c < ' ') target.Append("\\u").Append(((int)c).ToString("x4"));
                    else target.Append(c);
                    break;
            }
        }
    }

    public static string Snapshot()
    {
        IntPtr handle = GetForegroundWindow();
        string windowTitle = "";
        string exe = "";

        // No foreground window (locked screen, secure desktop) is a valid
        // sample with empty title and exe; the parent treats it as away.
        if (handle != IntPtr.Zero)
        {
            StringBuilder title = new StringBuilder(1024);
            int length = GetWindowTextW(handle, title, title.Capacity);
            if (length < 0) length = 0;
            if (length > title.Length) length = title.Length;
            windowTitle = title.ToString(0, length);

            int pid;
            GetWindowThreadProcessId(handle, out pid);
            if (pid > 0)
            {
                try { exe = Process.GetProcessById(pid).ProcessName; }
                catch (Exception) { exe = ""; }
            }
        }

        StringBuilder json = new StringBuilder(256);
        json.Append("{\"ok\":true,\"title\":\"");
        Escape(json, windowTitle);
        json.Append("\",\"exe\":\"");
        Escape(json, exe);
        json.Append("\",\"idleMs\":");
        json.Append(IdleMs());
        json.Append("}");
        return json.ToString();
    }
}
'@

try {
  Add-Type -TypeDefinition $source -ErrorAction Stop
} catch {
  # Keep stdout valid JSON; the detail goes to stderr for the parent process.
  [Console]::Error.WriteLine($_.Exception.ToString())
  [Console]::Out.WriteLine('{"ok":false,"error":"capture script failed to load"}')
  [Console]::Out.Flush()
  exit 1
}

# Parent liveness. shortcut: a recycled PID reads as alive; the write failure
# path below still ends the loop, so the orphan cannot survive a broken pipe.
function Test-ParentAlive {
  if ($ParentPid -le 0) { return $true }
  return $null -ne (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)
}

while ($true) {
  if (-not (Test-ParentAlive)) { exit 0 }

  # Snapshot failures are reported as a JSON line and the loop continues;
  # write failures mean the pipe is gone, so the loop must stop.
  $line = $null
  try {
    $line = [DayfilmCapture]::Snapshot()
  } catch {
    $line = '{"ok":false,"error":"snapshot failed"}'
  }

  try {
    [Console]::Out.WriteLine($line)
    [Console]::Out.Flush()
  } catch {
    exit 0
  }

  Start-Sleep -Milliseconds 2000
}
