// Desktop-only update notification bridge. Never installs unverified packages:
// the existing signed launcher is responsible for download, validation and rollback.
using System;
using System.IO;
using System.Net;
using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace FundiVoice {
    public static class UpdateNotice {
        static readonly object gate = new object();
        static DateTime nextCheckUtc = DateTime.MinValue;
        static string cachedVersion = "";
        static string cachedError = "";
        static string cachedRepo = "";
        static Version Parse(string value) {
            if(String.IsNullOrEmpty(value) || !Regex.IsMatch(value, @"^\d+\.\d+\.\d+$"))return null;
            try { return new Version(value); } catch { return null; }
        }
        static string VersionFile(string directory) {
            string value = File.ReadAllText(Path.Combine(directory,"VERSION.txt")).Trim();
            if(Parse(value)==null)throw new IOException("Некорректная локальная версия.");
            return value;
        }
        static string Launcher(string directory,string executable) {
            string location=Path.GetFullPath(directory);
            var parent=Directory.GetParent(location);
            if(parent!=null && String.Equals(parent.Name,"versions",StringComparison.OrdinalIgnoreCase) && parent.Parent!=null)
                location=parent.Parent.FullName;
            string path=Path.Combine(location,executable);
            if(!File.Exists(path))throw new IOException("Лаунчер не найден. Запусти программу через установленный ярлык.");
            return path;
        }
        public static object Check(string directory,string repo,string manifestName,string zipName,string executable) {
            string installed=VersionFile(directory);
            lock(gate) {
                if(!String.Equals(cachedRepo,repo,StringComparison.Ordinal) || DateTime.UtcNow >= nextCheckUtc) {
                    cachedRepo=repo;
                    cachedVersion="";
                    cachedError="";
                    nextCheckUtc=DateTime.UtcNow.AddMinutes(10);
                    try {
                        var request=WebRequest.CreateHttp("https://api.github.com/repos/Discolter/"+repo+"/releases/latest");
                        request.UserAgent="FundiVoice-Desktop-UpdateNotice/1.0";
                        request.Timeout=8000;
                        request.ReadWriteTimeout=8000;
                        request.Accept="application/vnd.github+json";
                        using(var response=(HttpWebResponse)request.GetResponse())
                        using(var reader=new StreamReader(response.GetResponseStream())) {
                            if(response.StatusCode!=HttpStatusCode.OK || response.ContentLength>262144)
                                throw new IOException("GitHub не вернул сведения об обновлении.");
                            string json=reader.ReadToEnd();
                            if(json.Length>262144)throw new IOException("Сведения GitHub слишком велики.");
                            var data=new JavaScriptSerializer().DeserializeObject(json) as System.Collections.Generic.Dictionary<string,object>;
                            if(data==null)throw new IOException("Некорректный ответ GitHub.");
                            object tag;
                            string version=data.TryGetValue("tag_name",out tag) && tag is string ? (string)tag : "";
                            if(!version.StartsWith("v",StringComparison.Ordinal) || Parse(version.Substring(1))==null)
                                throw new IOException("Недопустимый номер релиза.");
                            object draft,prerelease,assets;
                            if((data.TryGetValue("draft",out draft) && draft is bool && (bool)draft) ||
                               (data.TryGetValue("prerelease",out prerelease) && prerelease is bool && (bool)prerelease))
                                throw new IOException("Релиз не является стабильным.");
                            bool hasManifest=false,hasZip=false;
                            if(data.TryGetValue("assets",out assets) && assets is object[]) {
                                foreach(object item in (object[])assets) {
                                    var asset=item as System.Collections.Generic.Dictionary<string,object>;
                                    object name;
                                    if(asset==null || !asset.TryGetValue("name",out name) || !(name is string))continue;
                                    if((string)name==manifestName)hasManifest=true;
                                    if((string)name==zipName)hasZip=true;
                                }
                            }
                            if(!hasManifest || !hasZip)throw new IOException("Нет файлов подписанного обновления.");
                            cachedVersion=version.Substring(1);
                        }
                    } catch(Exception) {
                        cachedError="Не удалось проверить GitHub.";
                        nextCheckUtc=DateTime.UtcNow.AddMinutes(2);
                    }
                }
                var current=Parse(installed);
                var published=Parse(cachedVersion);
                bool available=published!=null && current!=null && published.CompareTo(current)>0 && cachedError=="";
                bool launcherFound=true;
                try { Launcher(directory,executable); } catch { launcherFound=false; }
                return new {
                    currentVersion=installed, latestVersion=available?cachedVersion:"",
                    available=available,canRestart=launcherFound,
                    releaseUrl=available?"https://github.com/Discolter/"+repo+"/releases/tag/v"+cachedVersion:"",
                    error=cachedError
                };
            }
        }

        // Edge --app windows are separate from the PowerShell/.NET localhost host.
        // Stopping the host alone leaves a stale browser window on the desktop.
        // Only close exact Fundi Voice application windows owned by Microsoft Edge.
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr parameter);
        delegate bool EnumWindowsCallback(IntPtr window, IntPtr parameter);
        [System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode)]
        static extern int GetWindowText(IntPtr window, StringBuilder title, int capacity);
        [System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode)]
        static extern int GetClassName(IntPtr window, StringBuilder name, int capacity);
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        static extern bool IsWindowVisible(IntPtr window);
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

        internal static bool IsAppWindowTitle(string title, bool actor) {
            if(actor)return title=="Fundi Voice Actor";
            return title=="Fundi Voice · Студия" || title=="Fundi Voice - Студия" ||
                title=="Fundi Voice – Студия" || title=="Fundi Voice — Студия";
        }
        public static void CloseOldAppWindows(bool actor) {
            // Never terminate the browser process: other Edge tabs/apps must survive.
            EnumWindows(delegate(IntPtr window, IntPtr unused) {
                try {
                    if(!IsWindowVisible(window))return true;
                    var caption=new StringBuilder(300);
                    if(GetWindowText(window,caption,caption.Capacity)<1 ||
                       !IsAppWindowTitle(caption.ToString(),actor))return true;
                    var windowClass=new StringBuilder(100);
                    GetClassName(window,windowClass,windowClass.Capacity);
                    if(windowClass.ToString()!="Chrome_WidgetWin_1")return true;
                    uint pid;
                    GetWindowThreadProcessId(window,out pid);
                    if(pid==0)return true;
                    using(var process=Process.GetProcessById((int)pid)) {
                        if(!String.Equals(process.ProcessName,"msedge",StringComparison.OrdinalIgnoreCase))
                            return true;
                    }
                    PostMessage(window,0x0010,IntPtr.Zero,IntPtr.Zero); // WM_CLOSE
                } catch(Exception) { /* A disappearing Edge window is not an update error. */ }
                return true;
            },IntPtr.Zero);
        }

        public static void Restart(string directory,string executable) {
            string launcher=Launcher(directory,executable);
            int pid=Process.GetCurrentProcess().Id;
            // Wait for the old host mutex to be released before starting the existing updater.
            string safePath=launcher.Replace("'","''");
            string script="$ErrorActionPreference='SilentlyContinue'; Wait-Process -Id "+pid+
                " -Timeout 35 -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 1600; Start-Process -FilePath '+safePath+"'";
            string powershell=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell","v1.0","powershell.exe");
            if(!File.Exists(powershell))throw new IOException("Не удалось найти Windows PowerShell для перезапуска.");
            string encoded=Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
            using(var process=Process.Start(new ProcessStartInfo(powershell,
                "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand "+encoded) {
                UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden
            })) {
                if(process==null)throw new IOException("Не удалось запустить перезапуск.");
            }
        }
    }
}
