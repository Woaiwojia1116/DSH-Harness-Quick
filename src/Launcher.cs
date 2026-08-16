// DeepSeek Harness Desktop Launcher
// Compiles to a Windows GUI exe (no console window) with a whale icon.
//   csc /target:winexe /out:..\dist\DeepSeek-Harness.exe /win32icon:..\build\icon.ico /reference:System.Windows.Forms.dll /reference:System.Drawing.dll Launcher.cs
//
// Behavior:
//   1. Check that node is on PATH (else show a message box).
//   2. If dsh web is already serving, just open the browser.
//   3. Otherwise spawn `npx @deepseek-ai/dsh web` hidden, poll until ready,
//      then open the browser.
//   4. Sit in the system tray so the user can open / stop / exit at will.
//
// Uses a single-instance Mutex so repeated double-clicks don't re-trigger.

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Management;
using System.Net.Sockets;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace DeepSeekHarness
{
    static class Launcher
    {
        const int Port = 3080;
        const string Host = "127.0.0.1";
        const int PollMs = 400;
        const int TimeoutMs = 60000;
        const string MutexName = "DeepSeekHarnessLauncher";
        const string LockFile = "deepseek-harness-launcher.lock";
        const string DshPidFile = "deepseek-harness-dsh.pid";

        static NotifyIcon tray;
        static Mutex mutex;

        [STAThread]
        static void Main()
        {
            // Single-instance guard.
            bool createdNew;
            mutex = new Mutex(true, MutexName, out createdNew);
            if (!createdNew)
            {
                // Another instance is already handling the launch.
                return;
            }

            Application.ApplicationExit += (s, e) =>
            {
                if (tray != null) { tray.Visible = false; tray.Dispose(); tray = null; }
                if (mutex != null) { mutex.ReleaseMutex(); mutex.Dispose(); mutex = null; }
            };

            try
            {
                bool ok = DoLaunch();
                // Whether launch succeeded, timed out, or errored, drop into the tray
                // so the user always has a way to manage the service.
                SetupTray(ok);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Unexpected error:\n" + ex.ToString(),
                    "DeepSeek Harness — error",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                SetupTray(false);
            }

            // Message loop — keeps the tray alive until the user exits.
            Application.Run();
        }

        // Returns true if the service is up (or came up), false on timeout.
        static bool DoLaunch()
        {
            string node = FindNode();
            if (node == null)
            {
                MessageBox.Show(
                    "Node.js was not found on this system.\n\n" +
                    "Please install Node.js LTS from https://nodejs.org and then retry.\n" +
                    "(The launcher needs it to run `npx @deepseek-ai/dsh web`.)",
                    "DeepSeek Harness — Node.js required",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return false;
            }

            // If dsh web is already serving, just open the browser.
            if (IsPortReady())
            {
                OpenBrowser();
                return true;
            }

            // Spawn `npx @deepseek-ai/dsh web` hidden.
            SpawnDsh(node);

            // Wait for it to come up, then open the browser.
            if (WaitForService())
            {
                OpenBrowser();
                return true;
            }
            else
            {
                // Timed out — open anyway, might finish loading.
                MessageBox.Show(
                    "dsh web did not respond on port " + Port + " within " +
                    (TimeoutMs / 1000) + "s.\n\n" +
                    "Opening the browser anyway — it may finish loading in a moment.\n" +
                    "If the page stays blank, try double-clicking the launcher again.",
                    "DeepSeek Harness — slow start",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
                OpenBrowser();
                return false;
            }
        }

        // ---------------------------------------------------------------------
        // Node / npx discovery, port polling, spawning, browser
        // ---------------------------------------------------------------------

        static string FindNode()
        {
            try
            {
                var psi = new ProcessStartInfo("where", "node")
                {
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                var p = Process.Start(psi);
                string output = p.StandardOutput.ReadToEnd();
                p.WaitForExit();
                foreach (var line in output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
                {
                    string trimmed = line.Trim();
                    if (File.Exists(trimmed)) return trimmed;
                }
            }
            catch { }
            return null;
        }

        static void SpawnDsh(string node)
        {
            // Run `cmd /c npx @deepseek-ai/dsh web` with no window.
            string npx = Path.Combine(Path.GetDirectoryName(node), "npx.cmd");
            if (!File.Exists(npx)) npx = Path.Combine(Path.GetDirectoryName(node), "npx");
            if (!File.Exists(npx)) npx = "npx"; // fallback to PATH

            var psi = new ProcessStartInfo("cmd", "/c \"" + npx + "\" @deepseek-ai/dsh web")
            {
                CreateNoWindow = true,
                UseShellExecute = false,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            var p = Process.Start(psi);
            // Persist the dsh web server PID so StopDsh() can kill it precisely
            // without scanning every node.exe on the machine.
            if (p != null)
            {
                try { File.WriteAllText(Path.Combine(Path.GetTempPath(), DshPidFile), p.Id.ToString()); }
                catch { /* ignore */ }
            }
        }

        static bool IsPortReady()
        {
            try
            {
                using (var c = new TcpClient())
                {
                    var result = c.BeginConnect(Host, Port, null, null);
                    var wait = result.AsyncWaitHandle.WaitOne(2000);
                    if (!wait) return false;
                    c.EndConnect(result);
                    return true;
                }
            }
            catch { return false; }
        }

        static bool WaitForService()
        {
            var deadline = DateTime.UtcNow.AddMilliseconds(TimeoutMs);
            while (DateTime.UtcNow < deadline)
            {
                if (IsPortReady()) return true;
                Thread.Sleep(PollMs);
            }
            return false;
        }

        static void OpenBrowser()
        {
            try
            {
                var psi = new ProcessStartInfo("cmd", "/c start \"\" http://" + Host + ":" + Port + "/")
                {
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                Process.Start(psi);
            }
            catch
            {
                // Last resort: use the shell directly.
                try { Process.Start("http://" + Host + ":" + Port + "/"); } catch { }
            }
        }

        // ---------------------------------------------------------------------
        // System tray
        // ---------------------------------------------------------------------

        static void SetupTray(bool serviceUp)
        {
            tray = new NotifyIcon();

            try
            {
                // Use the whale icon embedded in our own exe (the /win32icon one).
                tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            }
            catch
            {
                // No icon available — tray still works, just shows a default.
            }

            tray.Visible = true;
            UpdateTrayText(serviceUp);

            var menu = new ContextMenuStrip();

            var openItem = new ToolStripMenuItem("打开 DeepSeek Harness");
            openItem.Click += TrayOpen_Click;
            menu.Items.Add(openItem);

            menu.Items.Add(new ToolStripSeparator());

            var exitItem = new ToolStripMenuItem("退出");
            exitItem.Click += TrayExit_Click;
            menu.Items.Add(exitItem);

            tray.ContextMenuStrip = menu;
        }

        static void UpdateTrayText(bool serviceUp)
        {
            if (tray == null) return;
            tray.Text = serviceUp
                ? "DeepSeek Harness — 正在运行 (127.0.0.1:" + Port + ")"
                : "DeepSeek Harness — 已停止";
        }

        static void TrayOpen_Click(object sender, EventArgs e)
        {
            if (IsPortReady())
            {
                OpenBrowser();
                UpdateTrayText(true);
                return;
            }

            string node = FindNode();
            if (node == null)
            {
                MessageBox.Show(
                    "Node.js was not found — cannot start the service.",
                    "DeepSeek Harness — Node.js required",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            SpawnDsh(node);
            if (WaitForService())
            {
                OpenBrowser();
                UpdateTrayText(true);
            }
            else
            {
                OpenBrowser();
                MessageBox.Show(
                    "dsh web did not become ready in time. Opening browser anyway.",
                    "DeepSeek Harness — slow start",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }

        static void TrayExit_Click(object sender, EventArgs e)
        {
            StopDsh();
            if (tray != null)
            {
                tray.Visible = false;
                tray.Dispose();
                tray = null;
            }
            Application.Exit();
        }

        // ---------------------------------------------------------------------
        // Stop logic — inlined port of src/stop.js (no node / stop.js needed)
        // ---------------------------------------------------------------------

        static int StopDsh()
        {
            int killed = 0;

            // --- Strategy 1: PID-file fast path ---------------------------------
            // The launcher writes the dsh web server PID at spawn time. If it still
            // points at a real dsh process, kill it directly — no scan needed.
            string pidFile = Path.Combine(Path.GetTempPath(), DshPidFile);
            int? pidFromFile = null;
            try
            {
                if (File.Exists(pidFile))
                    pidFromFile = int.Parse(File.ReadAllText(pidFile).Trim());
            }
            catch { /* no / unreadable PID file — fall through to scan */ }

            if (pidFromFile.HasValue && IsDshPid(pidFromFile.Value))
            {
                try
                {
                    // /T = kill the whole process tree. dsh is spawned as
                    // `cmd /c npx …`, so node.exe is a grandchild — without /T it
                    // would survive.
                    var killPsi = new ProcessStartInfo("taskkill",
                        "/PID " + pidFromFile.Value + " /T /F")
                    {
                        CreateNoWindow = true,
                        UseShellExecute = false,
                        WindowStyle = ProcessWindowStyle.Hidden
                    };
                    var kp = Process.Start(killPsi);
                    kp.WaitForExit(5000);
                    killed++;
                }
                catch { /* ignore */ }
            }
            else
            {
                if (pidFromFile.HasValue)
                {
                    // Stale file: PID dead, or reused by a non-dsh process. Discard it.
                    try { File.Delete(pidFile); } catch { }
                }

                // --- Strategy 2: wmic scan fallback ----------------------------
                killed += ScanAndKillDsh();
            }

            // Always clean up the PID file so we never act on a stale one twice.
            try { if (File.Exists(pidFile)) File.Delete(pidFile); } catch { }

            // Best-effort cleanup of the Node launcher's lock file (the C# launcher
            // uses a Mutex, but stop.js / index.js create this file).
            try
            {
                string lockPath = Path.Combine(Path.GetTempPath(), LockFile);
                if (File.Exists(lockPath)) File.Delete(lockPath);
            }
            catch { }

            return killed;
        }

        // Is this PID alive AND its command line proves it is a dsh process?
        // Guards against PID reuse: Windows recycles PIDs, so a stale PID file
        // could point at a completely unrelated process.
        // Uses System.Management (WMI) — the .NET equivalent of PowerShell's
        // Get-CimInstance Win32_Process — instead of spawning wmic.exe.
        static bool IsDshPid(int pid)
        {
            if (!IsPidAlive(pid)) return false;
            try
            {
                var searcher = new ManagementObjectSearcher(
                    "SELECT CommandLine FROM Win32_Process WHERE ProcessId = " + pid);
                foreach (ManagementObject obj in searcher.Get())
                {
                    string cmdLine = obj["CommandLine"] as string ?? "";
                    if (Regex.IsMatch(cmdLine, "dsh|deepseek-ai", RegexOptions.IgnoreCase))
                        return true;
                }
                return false;
            }
            catch { return false; }
        }

        static bool IsPidAlive(int pid)
        {
            try
            {
                var psi = new ProcessStartInfo("tasklist", "/FI \"PID eq " + pid + "\" /NH")
                {
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                var p = Process.Start(psi);
                p.WaitForExit();
                // tasklist exits 0 if the process exists, 1 if not.
                return p.ExitCode == 0;
            }
            catch { return false; }
        }

        // Scan every node.exe and kill those whose command line matches dsh.
        // Uses System.Management (WMI) instead of spawning wmic.exe.
        static int ScanAndKillDsh()
        {
            int killed = 0;
            try
            {
                var searcher = new ManagementObjectSearcher(
                    "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'node.exe'");
                foreach (ManagementObject obj in searcher.Get())
                {
                    object pidObj = obj["ProcessId"];
                    string pidStr = pidObj != null ? pidObj.ToString() : "";
                    string cmdLine = obj["CommandLine"] as string ?? "";

                    if (!Regex.IsMatch(cmdLine, "dsh|deepseek-ai", RegexOptions.IgnoreCase))
                        continue;
                    if (!Regex.IsMatch(pidStr, "^\\d+$"))
                        continue;

                    try
                    {
                        var killPsi = new ProcessStartInfo("taskkill", "/PID " + pidStr + " /T /F")
                        {
                            CreateNoWindow = true,
                            UseShellExecute = false,
                            WindowStyle = ProcessWindowStyle.Hidden
                        };
                        var kp = Process.Start(killPsi);
                        kp.WaitForExit(5000);
                        killed++;
                    }
                    catch { /* ignore individual failures */ }
                }
            }
            catch { /* WMI unavailable — nothing we can do */ }
            return killed;
        }
    }
}
