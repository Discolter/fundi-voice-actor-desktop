using System;
using System.IO;
using System.Text;

namespace FundiVoice {
    public static class ActorDiagnostics {
        static readonly object gate=new object();
        public static void Write(string stage,Exception problem){
            try{lock(gate){
                string root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"FundiVoiceActor");
                Directory.CreateDirectory(root);string path=Path.Combine(root,"actor-startup.log");
                if(File.Exists(path)&&new FileInfo(path).Length>256*1024)File.Delete(path);
                // No exception messages, URLs, session values, credentials or request bodies.
                string detail=problem==null?"ok":problem.GetType().FullName+" "+problem.StackTrace;
                File.AppendAllText(path,DateTime.UtcNow.ToString("o")+" "+stage+" "+detail+Environment.NewLine,new UTF8Encoding(false));
            }}catch{}
        }
    }
}
