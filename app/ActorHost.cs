using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Windows.Forms;
using System.Drawing;
using FundiVoice.Desktop;

namespace FundiVoice {
    public static class ActorHost {
        static TcpListener listener;
        static string webRoot,dataRoot,key,origin,launchUrl;
        static int port;
        static volatile bool running;
        static ActorCloud cloud;
        static ActorTray tray;
        static readonly ManualResetEvent serverReady=new ManualResetEvent(false);
        static readonly string instanceId=Guid.NewGuid().ToString("N");
        static readonly HashSet<string> files=new HashSet<string>(StringComparer.Ordinal){
            "/","/index.html","/app.js","/core.js", "/file-tools.js", "/file-tools.css","/actor.css","/themes.css","/animated-themes.css","/brand-mark.png","/favicon.ico","/icon.svg"
        };
        public static void Run(string directory){
            webRoot=Path.Combine(Path.GetFullPath(directory),"web");
            dataRoot=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"FundiVoiceActor");
            Directory.CreateDirectory(dataRoot);
            bool created;
            using(var mutex=new Mutex(true,"Local\\FundiVoiceActor-"+Environment.UserName,out created)){
                if(!created){
                    string path=Path.Combine(dataRoot,"running.url");
                    if(File.Exists(path)){
                        string address=File.ReadAllText(path).Trim();
                        if(ReadyAddress(address,false)){Open(address);return;}
                    }
                    MessageBox.Show("Actor уже запущен, но его локальный сервер не отвечает. Заверши Actor через значок возле часов → Выход и открой его снова.","Fundi Voice Actor");
                    return;
                }
                try{
                    key=JsonData.RandomToken()+JsonData.RandomToken();
                    for(int candidate=43857;candidate<43877;candidate++){
                        try{listener=new TcpListener(IPAddress.Loopback,candidate);listener.Start(32);port=candidate;break;}
                        catch(SocketException){if(listener!=null)listener.Stop();}
                    }
                    if(port==0)throw new IOException("Не удалось открыть приложение. Перезапусти Windows.");
                    origin="http://127.0.0.1:"+port;launchUrl=origin+"/#key="+key;
                    File.WriteAllText(Path.Combine(dataRoot,"running.url"),launchUrl);
                    cloud=new ActorCloud(dataRoot);cloud.Notify=Notify;cloud.NotifyMessage=NotifyText;
                    running=true;
                    tray=new ActorTray(Path.Combine(webRoot,"favicon.ico"),delegate{Open(launchUrl);},delegate{cloud.SyncNow();},Exit);
                    ThreadPool.QueueUserWorkItem(delegate{
                        try{
                            if(!serverReady.WaitOne(5000)||!ReadyAddress(launchUrl,true))throw new IOException("Local host not ready.");
                            ActorDiagnostics.Write("local-host-ready",null);Open(launchUrl);
                        }catch(Exception problem){ActorDiagnostics.Write("open-window",problem);
                            try{MessageBox.Show("Не удалось открыть окно Actor. Открой программу ещё раз с ярлыка. Подробности сохранены в actor-startup.log в папке данных Actor.","Fundi Voice Actor");}catch{}}
                    });
                    // The main application thread owns the host until an explicit Exit.
                    // Browser and tray windows have no authority over this lifetime.
                    ActorDiagnostics.Write("host-start",null);Accept();

                }finally{
                    running=false;if(listener!=null)listener.Stop();if(cloud!=null)cloud.Dispose();
                    if(tray!=null)tray.Dispose();
                    try{File.Delete(Path.Combine(dataRoot,"running.url"));}catch{}
                    ActorDiagnostics.Write("host-stop",null);mutex.ReleaseMutex();
                }
            }
        }
        static void Notify(int added,int retakes){
            NotifyText("Fundi Voice Actor",(added>0?"Новых ролей: "+added+". ":"")+(retakes>0?"На перезапись: "+retakes+".":""));
        }
        static void NotifyText(string title,string text){if(tray!=null)tray.Show(title,text);}
        static void Exit(){running=false;if(listener!=null)listener.Stop();}
        static bool ReadyAddress(string url,bool currentInstance){
            Uri address;
            if(!Uri.TryCreate(url,UriKind.Absolute,out address)||address.Scheme!="http"||address.Host!="127.0.0.1"||address.UserInfo!=""||address.Port<43857||address.Port>=43877)return false;
            try{
                var request=WebRequest.CreateHttp(address.GetLeftPart(UriPartial.Authority)+"/health");
                request.Proxy=null;request.AllowAutoRedirect=false;request.Timeout=3000;request.ReadWriteTimeout=3000;request.KeepAlive=false;
                using(var response=(HttpWebResponse)request.GetResponse())
                using(var reader=new StreamReader(response.GetResponseStream())){
                    if(response.StatusCode!=HttpStatusCode.OK||response.ContentLength>4096)return false;
                    var data=JsonData.D(JsonData.Json().DeserializeObject(reader.ReadToEnd()));
                    return JsonData.S(data,"service")=="FundiVoiceActor"&&(!currentInstance||JsonData.S(data,"instanceId")==instanceId);
                }
            }catch{return false;}
        }
        static void Open(string url){
            string[] locations={
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),"Microsoft","Edge","Application","msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Microsoft","Edge","Application","msedge.exe")
            };
            foreach(string path in locations)if(File.Exists(path)){
                Process.Start(new ProcessStartInfo(path,"--app=\""+url+"\" --window-size=1200,820"){UseShellExecute=false});return;
            }
            throw new FileNotFoundException("Для окна Fundi Voice Actor нужен Microsoft Edge, входящий в Windows 10/11.");
        }
        static void Accept(){
            serverReady.Set();
            while(running){
                try{var client=listener.AcceptTcpClient();ThreadPool.QueueUserWorkItem(delegate{try{Handle(client);}catch(Exception problem){ActorDiagnostics.Write("local-client",problem);try{client.Close();}catch{}}});}
                catch(SocketException){if(!running)return;}
                catch(ObjectDisposedException){return;}
            }
        }
        static void Handle(TcpClient client){
            using(client){
                client.ReceiveTimeout=10000;client.SendTimeout=15000;
                using(var stream=client.GetStream()){
                    try{
                        var header=new List<byte>();int next;
                        while((next=stream.ReadByte())!=-1){
                            header.Add((byte)next);int n=header.Count;
                            if(n>16384){Json(stream,413,new{error="Слишком большой запрос."});return;}
                            if(n>=4&&header[n-4]==13&&header[n-3]==10&&header[n-2]==13&&header[n-1]==10)break;
                        }
                        if(header.Count==0)return;
                        var lines=Encoding.ASCII.GetString(header.ToArray()).Split(new[]{"\r\n"},StringSplitOptions.None);
                        var first=lines[0].Split(new[]{' '});if(first.Length!=3){Json(stream,400,new{error="Неверный запрос."});return;}
                        string method=first[0],path=first[1].Split(new[]{'?'})[0];
                        var headers=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
                        foreach(string line in lines.Skip(1)){int colon=line.IndexOf(':');if(colon>0)headers[line.Substring(0,colon).Trim()]=line.Substring(colon+1).Trim();}
                        string found;
                        if(!headers.TryGetValue("Host",out found)||found!="127.0.0.1:"+port){Json(stream,403,new{error="Неверный адрес."});return;}
                        if(method=="GET"&&path=="/health"){Json(stream,200,new{service="FundiVoiceActor",version="0.4.2",instanceId=instanceId});return;}
                        if(path.StartsWith("/api/",StringComparison.Ordinal)){
                            if(!headers.TryGetValue("X-Fundi-Key",out found)||found!=key||
                                (headers.TryGetValue("Origin",out found)&&found!=origin)||headers.ContainsKey("Transfer-Encoding")){
                                Json(stream,403,new{error="Открой Fundi Voice Actor с ярлыка или через FundiVoiceActor.exe."});return;
                            }
                            int length=0;
                            if(headers.ContainsKey("Content-Length")&&!Int32.TryParse(headers["Content-Length"],out length))throw new ArgumentException("Неверный запрос.");
                            if(length<0||length>16384){Json(stream,413,new{error="Слишком большой запрос."});return;}
                            byte[] body=new byte[length];int read=0;
                            while(read<length){int count=stream.Read(body,read,length-read);if(count==0)throw new IOException();read+=count;}
                            object value=length==0?null:JsonData.Json().DeserializeObject(Encoding.UTF8.GetString(body));
                            Route(stream,method,path.Substring(5),JsonData.D(value));return;
                        }
                        if(method!="GET"||!files.Contains(path)){Json(stream,404,new{error="Не найдено."});return;}
                        string file=Path.Combine(webRoot,path=="/"?"index.html":path.Substring(1));
                        if(!File.Exists(file)){Json(stream,404,new{error="Файл приложения не найден."});return;}
                        string ext=Path.GetExtension(file);
                        string mime=ext==".js"?"text/javascript; charset=utf-8":ext==".css"?"text/css; charset=utf-8":ext==".png"?"image/png":ext==".ico"?"image/x-icon":ext==".svg"?"image/svg+xml":"text/html; charset=utf-8";
                        Send(stream,200,File.ReadAllBytes(file),mime);
                    }catch(CloudFault problem){TryError(stream,problem.Message);}
                    catch(ArgumentException){TryError(stream,"Проверь введённые данные.");}
                    catch{TryError(stream,"Не удалось выполнить действие. Перезапусти Fundi Voice Actor.");}
                }
            }
        }
        static void Route(NetworkStream stream,string method,string route,Dictionary<string,object> body){
            if(method=="GET"&&route=="status"){Json(stream,200,cloud.Status());return;}
            if(method!="POST"){Json(stream,405,new{error="Неверный способ запроса."});return;}
            if(route=="login"||route=="activate"){Json(stream,200,cloud.Login(body,route=="activate"));return;}
            if(route=="logout"){Json(stream,200,cloud.Logout());return;}
            if(route=="sync"){Json(stream,200,cloud.SyncNow());return;}
            if(route=="vacation/start"){Json(stream,200,cloud.StartVacation(body));return;}
            if(route=="vacation/update"){Json(stream,200,cloud.UpdateVacation(body));return;}
            if(route=="vacation/end"){Json(stream,200,cloud.EndVacation());return;}
            if(route=="files/refresh"){Json(stream,200,cloud.FilesNow());return;}
            if(route=="files/upload"){
                string roleId=JsonData.S(body,"roleId");cloud.RequireUploadRole(roleId);
                string source=NativeFileDialogs.Pick(false);
                if(source==""){Json(stream,200,new{cancelled=true});return;}
                Json(stream,200,cloud.UploadRecording(roleId,source));return;
            }
            if(route=="files/confirm"){Json(stream,200,cloud.ConfirmRecording(JsonData.S(body,"fileId")));return;}
            if(route=="files/delete"){Json(stream,200,cloud.DeleteRecording(JsonData.S(body,"fileId")));return;}
            if(route=="transfer/cancel"){Json(stream,200,cloud.CancelTransfer());return;}
            if(route=="submit"){Json(stream,200,cloud.Submit(JsonData.S(body,"roleId")));return;}
            if(route=="messages/read"){Json(stream,200,cloud.ReadMessage(JsonData.N(body,"id")));return;}
            if(route=="messages/delete"){
                bool all=JsonData.B(body,"all");
                long[] ids=JsonData.A(body,"ids").Select(value=>{long parsed;return Int64.TryParse(Convert.ToString(value),out parsed)?parsed:0;}).ToArray();
                Json(stream,200,cloud.DeleteMessages(ids,all));return;
            }
            if(route=="messages/dismiss-failed"){Json(stream,200,cloud.DismissFailures());return;}
            if(route=="exit"){Json(stream,200,new{closed=true});Exit();return;}
            Json(stream,404,new{error="Неизвестное действие."});
        }
        static void TryError(NetworkStream stream,string message){try{Json(stream,400,new{error=message});}catch{}}
        static void Json(NetworkStream stream,int status,object value){Send(stream,status,Encoding.UTF8.GetBytes(JsonData.Json().Serialize(value)),"application/json; charset=utf-8");}
        static void Send(NetworkStream stream,int status,byte[] body,string type){
            string header="HTTP/1.1 "+status+" "+(status==200?"OK":"Error")+"\r\nContent-Type: "+type+
                "\r\nContent-Length: "+body.Length+"\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n"+
                "Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'\r\n\r\n";
            var bytes=Encoding.ASCII.GetBytes(header);stream.Write(bytes,0,bytes.Length);stream.Write(body,0,body.Length);stream.Flush();
        }
    }
}
