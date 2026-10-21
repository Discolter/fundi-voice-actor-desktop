using System;
using System.IO;
using System.Reflection;
using System.Runtime.Versioning;
using System.Windows.Forms;

[assembly: AssemblyTitle("Fundi Voice Actor")]
[assembly: AssemblyDescription("Личные проекты и роли актёра Fundi Voice")]
[assembly: AssemblyCompany("Fundi Voice")]
[assembly: AssemblyProduct("Fundi Voice Actor")]
[assembly: AssemblyVersion("0.4.0.0")]
[assembly: AssemblyFileVersion("0.4.0.0")]
[assembly: AssemblyInformationalVersion("0.4.0")]
[assembly: TargetFramework(".NETFramework,Version=v4.8")]

namespace FundiVoice {
    internal static class ActorProgram {
        [STAThread]
        static int Main() {
            ActorDiagnostics.Write("process-start",null);
            AppDomain.CurrentDomain.UnhandledException+=delegate(object sender,UnhandledExceptionEventArgs args){ActorDiagnostics.Write("unhandled",args.ExceptionObject as Exception);};
            try {
                string root=AppDomain.CurrentDomain.BaseDirectory;
                string[] required={"index.html","app.js","core.js","file-tools.js","file-tools.css","actor.css","themes.css","brand-mark.png"};
                foreach(string name in required) {
                    if(!File.Exists(Path.Combine(root,"web",name))) {
                        MessageBox.Show("Не хватает файлов приложения. Установи Fundi Voice Actor заново или распакуй переносную версию целиком.",
                            "Fundi Voice Actor",MessageBoxButtons.OK,MessageBoxIcon.Information);
                        return 1;
                    }
                }
                ActorHost.Run(root);
                return 0;
            }
            catch(FileNotFoundException problem) {
                ActorDiagnostics.Write("startup-file",problem);
                MessageBox.Show(problem.Message,"Fundi Voice Actor",MessageBoxButtons.OK,MessageBoxIcon.Information);
                return 1;
            }
            catch(Exception problem) {
                ActorDiagnostics.Write("startup-failed",problem);
                MessageBox.Show("Не удалось открыть Fundi Voice Actor. Перезапусти приложение. Если ошибка повторяется, переустанови его и сообщи руководителю студии.",
                    "Fundi Voice Actor",MessageBoxButtons.OK,MessageBoxIcon.Error);
                return 1;
            }
        }
    }
}
