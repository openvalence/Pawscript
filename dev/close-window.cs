// dev/close-window.cs -- paw-ee14: asks the test instance's window to close the way the title bar's X or Alt+F4 does
// (WM_CLOSE -> the shell's CloseRequested). Run on the test instance's hidden desktop through hidden-desktop.exe (a window
// is only found from its own desktop); dev/cow-check.mjs builds and runs it. Only visible titled top-level windows of a
// process whose image path contains the given text are asked.
//   close-window.exe <text in the exe path>
using System; using System.Text; using System.Runtime.InteropServices;

static class CloseWindow {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowTextLengthW(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageNameW(IntPtr p, uint flags, StringBuilder name, ref uint size);

  static int Main(string[] args) {
    string want = args.Length > 0 ? args[0].ToLowerInvariant() : null;
    if (string.IsNullOrEmpty(want)) return 2;
    int n = 0;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h) || GetWindowTextLengthW(h) == 0) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      IntPtr p = OpenProcess(0x1000, false, pid);   // PROCESS_QUERY_LIMITED_INFORMATION
      if (p == IntPtr.Zero) return true;
      var sb = new StringBuilder(1024); uint size = 1024;
      bool ok = QueryFullProcessImageNameW(p, 0, sb, ref size);
      CloseHandle(p);
      if (ok && sb.ToString().ToLowerInvariant().Contains(want)) { PostMessageW(h, 0x0010, IntPtr.Zero, IntPtr.Zero); n++; }
      return true;
    }, IntPtr.Zero);
    Console.WriteLine("asked " + n);
    return n > 0 ? 0 : 1;
  }
}
