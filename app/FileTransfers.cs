using System;
using System.IO;
using System.Net;
using System.Threading;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace FundiVoice.Desktop {
    // One bounded, cancellable transfer per application. Credentials and signed URLs stay native.
    public sealed class FileJobs : IDisposable {
        readonly object gate=new object();
        TransferJob current;
        public bool Busy { get { lock(gate)return current!=null&&current.Busy; } }
        public object View(){lock(gate)return current==null?null:current.View();}
        public void Start(string direction,string name,long size,string roleId,Action<TransferJob> work){
            TransferJob job;
            lock(gate){
                if(current!=null&&current.Busy)throw new CloudFault(409,"transfer_busy","Дождись завершения передачи или отмени её.");
                current=job=new TransferJob(direction,name,size,roleId);
            }
            ThreadPool.QueueUserWorkItem(delegate{
                try{work(job);job.Finish();}
                catch(OperationCanceledException){job.Fail("Передача отменена.",true);}
                catch(CloudFault problem){job.Fail(problem.Message,false);}
                catch(UnauthorizedAccessException){job.Fail("Нет доступа к файлу или папке. Выбери другую папку и повтори.",false);}
                catch(IOException){job.Fail("Передача прервалась или не хватает места на диске. Повтори действие; готовые файлы сохранены.",false);}
                catch(WebException problem){job.Fail(R2Transfer.NetworkMessage(problem),false);}
                catch{job.Fail("Не удалось передать файл. Повтори действие.",false);}
            });
        }
        public void Cancel(){lock(gate){if(current!=null)current.Cancel();}}
        public void Dispose(){Cancel();}
    }
    public sealed class TransferJob {
        readonly object gate=new object();
        readonly string id=Guid.NewGuid().ToString("N"),direction,name,roleId;
        readonly long total;
        string state="running",phase="Подключаемся…",error="",path="",fileId="";
        long bytes;
        bool cancelled,committing;
        HttpWebRequest request;
        public TransferJob(string direction,string name,long total,string roleId){this.direction=direction;this.name=name;this.total=total;this.roleId=roleId;}
        public bool Busy {get{lock(gate)return state=="running";}}
        public object View(){lock(gate)return new{id=id,direction=direction,fileName=name,roleId=roleId,fileId=fileId,
            state=state,phase=phase,error=error,bytes=bytes,totalBytes=total,path=path,
            folder=path==""?"":Path.GetDirectoryName(path),canCancel=state=="running"&&!committing&&!cancelled};}
        public void SetPhase(string value){lock(gate)phase=value;}
        public void SetFileId(string value){lock(gate)fileId=value;}
        public void SetPath(string value){lock(gate)path=value;}
        public void Progress(long value){lock(gate)bytes=value;Check();}
        public void Check(){lock(gate){if(cancelled)throw new OperationCanceledException();}}
        public void Track(HttpWebRequest value){lock(gate){if(cancelled){value.Abort();throw new OperationCanceledException();}request=value;}}
        public void Release(){lock(gate)request=null;}
        public void Commit(){lock(gate){Check();committing=true;phase="Подтверждаем передачу…";request=null;}}
        public void Cancel(){HttpWebRequest active;lock(gate){if(state!="running"||committing)return;cancelled=true;phase="Отменяем…";active=request;}if(active!=null)active.Abort();}
        public void Finish(){lock(gate){state=cancelled?"cancelled":"done";phase=cancelled?"Передача отменена.":"Готово";}}
        public void Fail(string message,bool wasCancelled){lock(gate){bool cancel=cancelled||wasCancelled;state=cancel?"cancelled":"error";error=cancel?"":message;phase=cancel?"Передача отменена.":"Передача не завершена";request=null;}}
    }
    public static class R2Transfer {
        public const long MaximumBytes=2L*1024*1024*1024;
        public const int TransferTimeout=45*60*1000,IdleTimeout=2*60*1000;
        public static Uri Address(string raw){
            Uri uri;
            if(!Uri.TryCreate(raw,UriKind.Absolute,out uri)||uri.Scheme!="https"||uri.Port!=443||uri.UserInfo!=""||uri.Fragment!=""||
                !Regex.IsMatch(uri.Host,@"\A[a-fA-F0-9]{32}(?:\.eu)?\.r2\.cloudflarestorage\.com\z",RegexOptions.IgnoreCase)||
                !Regex.IsMatch(uri.AbsolutePath,@"\A/[a-z0-9-]{3,63}/recordings/[a-f0-9]{32}\z")||
                uri.Query.IndexOf("X-Amz-Signature=",StringComparison.Ordinal)<0)
                throw new CloudFault(502,"invalid_file_url","Сервер вернул неверную ссылку на файл. Проверь настройки R2.");
            return uri;
        }
        static HttpWebRequest Create(string url,string method){
            // Let Windows negotiate current TLS versions (TLS 1.2 / 1.3) and verify the certificate.
            ServicePointManager.SecurityProtocol=SecurityProtocolType.SystemDefault;
            var request=(HttpWebRequest)WebRequest.Create(Address(url));
            request.Method=method;request.AllowAutoRedirect=false;request.KeepAlive=false;
            // Timeout covers the WHOLE synchronous request, including the streamed body.
            // Keep an independent inactivity bound so a dead connection remains cancellable.
            request.Timeout=TransferTimeout;request.ReadWriteTimeout=IdleTimeout;
            request.UserAgent="FundiVoice-Windows/1.6.1";
            request.AutomaticDecompression=DecompressionMethods.None;
            return request;
        }
        public static string NetworkMessage(WebException problem){
            var response=problem.Response as HttpWebResponse;
            if(response!=null){int status=(int)response.StatusCode;response.Close();
                if(status==403)return "Ссылка на запись истекла или отклонена хранилищем (HTTP 403). Выбери тот же файл повторно.";
                return "Хранилище вернуло ошибку HTTP "+status+". Повтори передачу.";
            }
            if(problem.Status==WebExceptionStatus.Timeout)return "Истекло время ожидания передачи. Проверь соединение и повтори.";
            if(problem.Status==WebExceptionStatus.TrustFailure)
                return "Windows отклонила сертификат Cloudflare R2. Проверь часы, корневые сертификаты Windows и HTTPS-проверку антивируса.";
            if(problem.Status==WebExceptionStatus.SecureChannelFailure)
                return "Не удалось согласовать TLS с Cloudflare R2. Проверь обновления Windows, VPN/прокси и повтори скачивание.";
            return "Соединение с хранилищем прервалось. Выбери тот же файл повторно.";
        }
        public static void Upload(string url,string source,long expected,TransferJob job){
            Put(Create(url,"PUT"),source,expected,job);
        }
        internal static void Put(HttpWebRequest request,string source,long expected,TransferJob job){
            if(expected<1||expected>MaximumBytes)throw new CloudFault(400,"invalid_file","Выбери запись от 1 байта до 2 ГиБ.");
            request.AllowAutoRedirect=false;request.AllowWriteStreamBuffering=false;
            request.SendChunked=false;request.ContentLength=expected;request.ContentType="application/octet-stream";
            request.ServicePoint.Expect100Continue=false;
            job.Track(request);
            try{
                using(var input=new FileStream(source,FileMode.Open,FileAccess.Read,FileShare.Read)){
                    if(input.Length!=expected)throw new CloudFault(409,"file_changed","Файл изменился. Закончи экспорт записи и выбери его заново.");
                    job.SetPhase("Загружаем запись…");
                    using(var output=request.GetRequestStream())Copy(input,output,expected,job);
                }
                using(var response=(HttpWebResponse)request.GetResponse()){
                    if((int)response.StatusCode<200||(int)response.StatusCode>=300)throw new IOException();
                }
                job.Check();
            }finally{job.Release();request.Abort();}
        }
        public static void Download(string url,string folder,string name,long expected,TransferJob job){
            Receive(Create(url,"GET"),folder,name,expected,job);
        }
        internal static void Receive(HttpWebRequest request,string folder,string name,long expected,TransferJob job){
            if(expected<1||expected>MaximumBytes)throw new CloudFault(502,"invalid_file_size","Сервер вернул неверный размер записи.");
            folder=Path.GetFullPath(folder);
            if(!Directory.Exists(folder))throw new DirectoryNotFoundException();
            name=SafeName(name);
            string partial=Path.Combine(folder,".fundi-part-"+Guid.NewGuid().ToString("N"));
            request.AllowAutoRedirect=false;request.AutomaticDecompression=DecompressionMethods.None;
            job.Track(request);
            try{
                using(var response=(HttpWebResponse)request.GetResponse()){
                    if((int)response.StatusCode!=200||(response.ContentLength>=0&&response.ContentLength!=expected))
                        throw new CloudFault(502,"file_size_mismatch","Размер записи не совпал. Файл не сохранён; повтори скачивание.");
                    job.SetPhase("Скачиваем запись…");
                    using(var input=response.GetResponseStream())
                    using(var output=new FileStream(partial,FileMode.CreateNew,FileAccess.Write,FileShare.None))Copy(input,output,expected,job);
                }
                job.Commit();
                for(int number=0;number<10000;number++){
                    string target=Path.Combine(folder,number==0?name:Path.GetFileNameWithoutExtension(name)+" ("+(number+1)+")"+Path.GetExtension(name));
                    if(File.Exists(target)||Directory.Exists(target))continue;
                    try{File.Move(partial,target);job.SetPath(target);return;}
                    catch(IOException){if(File.Exists(target)||Directory.Exists(target))continue;throw;}
                }
                throw new IOException("No available filename.");
            }finally{
                job.Release();request.Abort();
                try{if(File.Exists(partial))File.Delete(partial);}catch{}
            }
        }
        internal static void Copy(Stream input,Stream output,long expected,TransferJob job){
            var buffer=new byte[128*1024];long written=0;
            while(written<expected){
                job.Check();int count=input.Read(buffer,0,(int)Math.Min(buffer.Length,expected-written));
                if(count==0)throw new CloudFault(502,"file_incomplete","Передача оборвалась. Неполная запись не сохранена; повтори действие.");
                output.Write(buffer,0,count);written+=count;job.Progress(written);
            }
            if(input.ReadByte()!=-1)throw new CloudFault(502,"file_size_mismatch","Размер записи изменился. Повтори передачу.");
            job.Check();
        }
        public static string SafeName(string raw){
            string name=raw??"";
            foreach(char bad in "<>:\"/\\|?*")name=name.Replace(bad,'_');
            var chars=name.ToCharArray();for(int i=0;i<chars.Length;i++)if(Char.IsControl(chars[i]))chars[i]='_';
            name=new String(chars).Trim().TrimEnd('.',' ');
            if(name.Length>180)name=name.Substring(0,160)+Path.GetExtension(name);
            if(name==""||name=="."||name=="..")name="recording.wav";
            string stem=Path.GetFileNameWithoutExtension(name).ToUpperInvariant();
            if(Regex.IsMatch(stem,@"\A(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\z"))name="_"+name;
            string ext=Path.GetExtension(name).ToLowerInvariant();
            if(ext!=".wav"&&ext!=".zip"&&ext!=".flac"&&ext!=".mp3"&&ext!=".ogg")
                throw new CloudFault(400,"invalid_file","Разрешены WAV, ZIP, FLAC, MP3 и OGG.");
            return name;
        }
    }
    public static class NativeFileDialogs {
        static readonly object gate=new object();
        public static string Pick(bool folder){
            lock(gate){
                string selected="";Exception failure=null;
                var thread=new Thread(delegate(){
                    try{using(var owner=new Form{TopMost=true,ShowInTaskbar=false,Opacity=0,Width=1,Height=1,StartPosition=FormStartPosition.CenterScreen}){
                        owner.Show();owner.Activate();
                        if(folder){using(var dialog=new FolderBrowserDialog{Description="Fundi Voice — куда сохранить запись?",ShowNewFolderButton=true})
                            if(dialog.ShowDialog(owner)==DialogResult.OK)selected=dialog.SelectedPath;}
                        else{using(var dialog=new OpenFileDialog{Title="Fundi Voice — выбери готовую запись",CheckFileExists=true,Multiselect=false,
                            Filter="Записи и архивы|*.wav;*.zip;*.flac;*.mp3;*.ogg"})if(dialog.ShowDialog(owner)==DialogResult.OK)selected=dialog.FileName;}
                    }}catch(Exception problem){failure=problem;}
                });
                thread.SetApartmentState(ApartmentState.STA);thread.Start();thread.Join();
                if(failure!=null)throw new CloudFault(400,"dialog_failed","Не удалось открыть выбор файла или папки. Повтори действие.");
                return selected;
            }
        }
    }
}
