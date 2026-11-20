// dev/hidden-desktop.cs -- run one command on a separate, never-displayed Win32 desktop (WinSta0\PawscriptTest).
// dev/test-app.mjs compiles it with the C# compiler that ships with Windows (.NET Framework 4) into a GUI-subsystem
// exe (no console of its own, ever) and runs the app and its preview server through it. Not meant to be run by hand.
// Windows on a desktop that is not the input desktop cannot become the foreground window, take focus or knock a
// fullscreen game out, whatever flags the app sets; every child process (cargo, the app, WebView2) inherits the desktop.
//   hidden-desktop.exe <instance id>       the id is only there so dev/test-app.mjs stop can recognise this process
//   env PAWTEST_CMD   the command line to run
//   env PAWTEST_OUT   file for its stdout; PAWTEST_ERR for its stderr (and for this launcher's own errors)
// The command runs with CREATE_NO_WINDOW (a console without a window, which its children share) in a kill-on-close
// job: when this launcher ends or is killed, the whole tree ends with it.
using System; using System.IO; using System.Text; using System.Runtime.InteropServices; using System.ComponentModel;

static class HiddenDesktop {
  const string Desktop = "PawscriptTest";
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO { public int cb; public string lpReserved, lpDesktop, lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
  struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  struct BASIC_LIMIT { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
  struct EXTENDED_LIMIT { public BASIC_LIMIT Basic; public ulong r1, r2, r3, r4, r5, r6; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateDesktopW(string name, IntPtr dev, IntPtr mode, uint flags, uint access, IntPtr sa);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcessW(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObjectW(IntPtr sa, IntPtr name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref EXTENDED_LIMIT info, int len);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr h, uint mask, uint flags);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr t);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  static IntPtr Inheritable(FileStream f) { IntPtr h = f.SafeFileHandle.DangerousGetHandle(); SetHandleInformation(h, 1, 1); return h; }
  static void Check(bool ok, string what) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error(), what); }

  static int Main() {
    var o = new FileStream(Environment.GetEnvironmentVariable("PAWTEST_OUT"), FileMode.Create, FileAccess.Write, FileShare.ReadWrite);
    var e = new FileStream(Environment.GetEnvironmentVariable("PAWTEST_ERR"), FileMode.Create, FileAccess.Write, FileShare.ReadWrite);
    try { return Run(Environment.GetEnvironmentVariable("PAWTEST_CMD"), o, e); }
    catch (Exception x) { var b = Encoding.UTF8.GetBytes("hidden-desktop: " + x.Message + Environment.NewLine); e.Write(b, 0, b.Length); e.Flush(); return 1; }
  }

  static int Run(string cmd, FileStream o, FileStream e) {
    // GENERIC_ALL. Opens the desktop if another instance already made it; this handle keeps it alive while we run.
    IntPtr desk = CreateDesktopW(Desktop, IntPtr.Zero, IntPtr.Zero, 0, 0x10000000, IntPtr.Zero);
    Check(desk != IntPtr.Zero, "CreateDesktop " + Desktop);
    IntPtr job = CreateJobObjectW(IntPtr.Zero, IntPtr.Zero);
    Check(job != IntPtr.Zero, "CreateJobObject");
    var lim = new EXTENDED_LIMIT(); lim.Basic.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    Check(SetInformationJobObject(job, 9, ref lim, Marshal.SizeOf(typeof(EXTENDED_LIMIT))), "SetInformationJobObject");
    var si = new STARTUPINFO(); si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
    si.lpDesktop = @"WinSta0\" + Desktop;
    si.dwFlags = 0x100 | 0x1; si.wShowWindow = 4; // STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW, SW_SHOWNOACTIVATE
    si.hStdOutput = Inheritable(o); si.hStdError = Inheritable(e);
    PROCESS_INFORMATION pi;
    // CREATE_SUSPENDED (join the job before it can start anything) | CREATE_NO_WINDOW
    Check(CreateProcessW(null, new StringBuilder(cmd), IntPtr.Zero, IntPtr.Zero, true, 0x4 | 0x08000000, IntPtr.Zero, null, ref si, out pi), "CreateProcess");
    Check(AssignProcessToJobObject(job, pi.hProcess), "AssignProcessToJobObject");
    ResumeThread(pi.hThread);
    WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
    uint code; GetExitCodeProcess(pi.hProcess, out code);
    return (int)code;
  }
}
