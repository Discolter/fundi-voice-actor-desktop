using System;
using System.IO;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;

namespace FundiVoice {
    // The notification UI has its own message loop. Closing it cannot stop the HTTP host.
    public sealed class ActorTray : IDisposable {
        readonly ManualResetEvent ready=new ManualResetEvent(false);
        Control dispatcher;
        NotifyIcon icon;
        volatile bool disposed;
        public ActorTray(string iconPath,Action open,Action sync,Action exit){
            var thread=new Thread(delegate(){
                ApplicationContext context=null;
                try{
                    dispatcher=new Control();
                    if(dispatcher.Handle==IntPtr.Zero)throw new InvalidOperationException();
                    context=new ApplicationContext();
                    icon=new NotifyIcon{Text="Fundi Voice Actor",Icon=SystemIcons.Information,Visible=true};
                    if(File.Exists(iconPath)){try{icon.Icon=new Icon(iconPath);}catch(Exception problem){ActorDiagnostics.Write("tray-icon",problem);}}
                    var menu=new ContextMenuStrip();
                    menu.Items.Add("Открыть Fundi Voice Actor",null,delegate{Safe(open);});
                    menu.Items.Add("Обновить роли",null,delegate{ThreadPool.QueueUserWorkItem(delegate{Safe(sync);});});
                    menu.Items.Add("Выход",null,delegate{Safe(exit);});
                    icon.ContextMenuStrip=menu;icon.DoubleClick+=delegate{Safe(open);};icon.BalloonTipClicked+=delegate{Safe(open);};
                    ready.Set();if(!disposed)Application.Run(context);
                }catch(Exception problem){ActorDiagnostics.Write("tray-loop",problem);ready.Set();}
                finally{
                    if(icon!=null){try{icon.Visible=false;icon.Dispose();}catch{}}
                    if(dispatcher!=null){try{dispatcher.Dispose();}catch{}}
                    if(context!=null)context.Dispose();
                }
            });
            thread.IsBackground=true;thread.Name="Fundi Voice Actor notifications";thread.SetApartmentState(ApartmentState.STA);thread.Start();ready.WaitOne(3000);
        }
        static void Safe(Action action){try{action();}catch(Exception problem){ActorDiagnostics.Write("tray-action",problem);}}
        public void Show(string title,string text){
            if(disposed||dispatcher==null||dispatcher.IsDisposed)return;
            if(title.Length>60)title=title.Substring(0,57)+"…";
            if(text.Length>250)text=text.Substring(0,247)+"…";
            try{dispatcher.BeginInvoke((Action)delegate{try{if(icon!=null)icon.ShowBalloonTip(6000,title,text,ToolTipIcon.Info);}catch(Exception problem){ActorDiagnostics.Write("notification",problem);}});}catch(Exception problem){ActorDiagnostics.Write("notification-dispatch",problem);}
        }
        public void Dispose(){
            disposed=true;
            try{if(dispatcher!=null&&!dispatcher.IsDisposed)dispatcher.BeginInvoke((Action)delegate{Application.ExitThread();});}catch{}
        }
    }
}
