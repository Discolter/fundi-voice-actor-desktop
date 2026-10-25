using System;
using System.IO;
using System.Collections.Generic;
using System.Threading;
using System.Text.RegularExpressions;
using System.Globalization;
using FundiVoice.Desktop;

namespace FundiVoice {
    public sealed partial class ActorCloud : IDisposable {
        readonly string sessionFile;
        readonly object gate=new object(),syncGate=new object();
        readonly ReviewMailbox mailbox;
        Dictionary<string,object> session=new Dictionary<string,object>();
        Timer timer;
        string error="";
        bool busy=false;
        public Action<int,int> Notify;
        public Action<string,string> NotifyMessage;
        public ActorCloud(string dataRoot){
            sessionFile=Path.Combine(dataRoot,"session.bin");
            try{session=PrivateFile.Read(sessionFile);}catch(CloudFault problem){error=problem.Message;}
            mailbox=new ReviewMailbox(dataRoot);
            mailbox.Bind(JsonData.S(session,"server"),JsonData.S(session,"username"));
            timer=new Timer(delegate{Poll();},null,1000,60000);
        }
        bool Authenticated(){return JsonData.S(session,"refreshToken")!="";}
        public object Status(){
            lock(gate){
                object view;session.TryGetValue("view",out view);
                return new{authenticated=Authenticated(),server=JsonData.S(session,"server"),username=JsonData.S(session,"username"),
                    lastSync=JsonData.S(session,"lastSync"),busy=busy,error=error,view=view,mailbox=mailbox.View(),
                    fileApiAvailable=fileApiAvailable,files=recordingFiles,usedBytes=usedBytes,quotaBytes=quotaBytes,fileError=fileError,transfer=transfers.View(),vacation=vacationData, vacationError=vacationError,vacationApiAvailable=vacationApiAvailable};
            }
        }
        public object Login(Dictionary<string,object> data,bool activate){
            lock(syncGate){
                if(transfers.Busy)throw new CloudFault(409,"transfer_busy","Сначала заверши или отмени загрузку записи.");
                string server=CloudHttp.Server(JsonData.S(data,"server"));
                string username=JsonData.S(data,"username"),password=JsonData.S(data,"password");
                object body;
                if(activate){
                    string input=JsonData.S(data,"code");
                    var code=Regex.Match(input,@"(?<![a-fA-F0-9])[a-fA-F0-9]{64}(?![a-fA-F0-9])");
                    if(!code.Success)throw new CloudFault(400,"invalid_invite","Вставь код из приглашения руководителя.");
                    var address=Regex.Match(input,@"https://[A-Za-z0-9.-]+(?::[0-9]+)?");
                    if(address.Success)server=CloudHttp.Server(address.Value);
                    body=new{code=code.Value,username=username,password=password};
                }else body=new{username=username,password=password};
                var response=CloudHttp.Request(server,activate?"/v1/actor/activate":"/v1/actor/login","POST",body,null);
                lock(gate){
                    session=new Dictionary<string,object>{{"server",server},{"accessToken",JsonData.S(response,"accessToken")},
                        {"refreshToken",JsonData.S(response,"refreshToken")},{"accessExpiresAt",JsonData.S(response,"accessExpiresAt")},
                        {"username",JsonData.S(response,"username")},{"lastSync",""}};
                    PrivateFile.Save(sessionFile,session);error="";
                    mailbox.Bind(server,JsonData.S(response,"username"));ClearVacation();
                }
                Poll();
            }
            return Status();
        }
        public object SyncNow(){Poll();return Status();}
        public object SetRecording(string roleId,bool recording){
            lock(syncGate){
                if(!Authenticated())throw new CloudFault(401,"login_required","Сначала войди в аккаунт.");
                // Refresh token and current feed before sending a role-specific change.
                Poll();
                string server,access;
                lock(gate){server=JsonData.S(session,"server");access=JsonData.S(session,"accessToken");}
                if(String.IsNullOrEmpty(access))throw new CloudFault(401,"session_expired","Войди в аккаунт заново.");
                CloudHttp.Request(server,"/v1/actor/recording","POST",new{roleId=roleId,recording=recording},access);
                Poll();
                return Status();
            }
        }
        public object SetRoleVisibility(string roleId,bool hidden){
            lock(syncGate){
                if(!Authenticated())throw new CloudFault(401,"login_required","Сначала войди в аккаунт.");
                Poll();
                string server,access;
                lock(gate){server=JsonData.S(session,"server");access=JsonData.S(session,"accessToken");}
                if(String.IsNullOrEmpty(access))throw new CloudFault(401,"session_expired","Войди в аккаунт заново.");
                CloudHttp.Request(server,"/v1/actor/roles/visibility","POST",new{roleId=roleId,hidden=hidden},access);
                Poll();
                return Status();
            }
        }
        public object Logout(){
            string server,refresh;
            lock(syncGate)lock(gate){
                if(transfers.Busy)throw new CloudFault(409,"transfer_busy","Сначала заверши или отмени загрузку записи.");
                recordingFiles=new object[0];usedBytes=0;fileApiAvailable=false;fileError="";ClearVacation();
                server=JsonData.S(session,"server");refresh=JsonData.S(session,"refreshToken");
                session=new Dictionary<string,object>();File.Delete(sessionFile);mailbox.Clear();error="";
            }
            if(server!=""&&refresh!="")ThreadPool.QueueUserWorkItem(delegate{try{CloudHttp.Request(server,"/v1/actor/logout","POST",new{refreshToken=refresh},null);}catch{}});
            return Status();
        }
        void Poll(){
            if(!Monitor.TryEnter(syncGate))return;
            try{
                string server,access,refresh,expires;
                Dictionary<string,object> oldView;
                lock(gate){
                    if(!Authenticated())return;
                    busy=true;server=JsonData.S(session,"server");access=JsonData.S(session,"accessToken");refresh=JsonData.S(session,"refreshToken");
                    expires=JsonData.S(session,"accessExpiresAt");object old;session.TryGetValue("view",out old);oldView=JsonData.D(old);
                }
                DateTime until;
                if(!DateTime.TryParse(expires,CultureInfo.InvariantCulture,DateTimeStyles.RoundtripKind,out until)||until.ToUniversalTime()<DateTime.UtcNow.AddMinutes(1)){
                    var rotated=CloudHttp.Request(server,"/v1/actor/refresh","POST",new{refreshToken=refresh},null);
                    access=JsonData.S(rotated,"accessToken");
                    lock(gate){
                        session["accessToken"]=access;session["refreshToken"]=JsonData.S(rotated,"refreshToken");
                        session["accessExpiresAt"]=JsonData.S(rotated,"accessExpiresAt");PrivateFile.Save(sessionFile,session);
                    }
                }
                Dictionary<string,object> view;
                try{view=CloudHttp.Request(server,"/v1/actor/roles","GET",null,access);}
                catch(CloudFault problem){
                    if(problem.Status!=401)throw;
                    var rotated=CloudHttp.Request(server,"/v1/actor/refresh","POST",new{refreshToken=JsonData.S(session,"refreshToken")},null);
                    access=JsonData.S(rotated,"accessToken");
                    lock(gate){
                        session["accessToken"]=access;session["refreshToken"]=JsonData.S(rotated,"refreshToken");
                        session["accessExpiresAt"]=JsonData.S(rotated,"accessExpiresAt");PrivateFile.Save(sessionFile,session);
                    }
                    view=CloudHttp.Request(server,"/v1/actor/roles","GET",null,access);
                }
                Dictionary<string,object> message=null;
                if(JsonData.B(view,"reviewApiAvailable")){
                    Func<string,string,object,Dictionary<string,object>> send=delegate(string path,string method,object body){return CloudHttp.Request(server,path,method,body,access);};
                    if(mailbox.Drain(send,false)>0)view=CloudHttp.Request(server,"/v1/actor/roles","GET",null,access);
                    message=mailbox.Fetch(send,false);
                }
                object oldRaw,newRaw;oldView.TryGetValue("feed",out oldRaw);view.TryGetValue("feed",out newRaw);
                var previous=new Dictionary<string,string>(StringComparer.Ordinal);
                foreach(var raw in JsonData.A(JsonData.D(oldRaw),"roles")){var r=JsonData.D(raw);previous[JsonData.S(r,"roleId")]=JsonData.S(r,"status");}
                int added=0,retakes=0;
                foreach(var raw in JsonData.A(JsonData.D(newRaw),"roles")){
                    var role=JsonData.D(raw);string status=JsonData.S(role,"status"),before;
                    if(!previous.TryGetValue(JsonData.S(role,"roleId"),out before))added++;
                    else if(status=="retake"&&before!="retake")retakes++;
                }
                lock(gate){session["view"]=view;session["lastSync"]=DateTime.UtcNow.ToString("o");PrivateFile.Save(sessionFile,session);error="";}
                RefreshFiles(false);
                RefreshVacation(server,access);
                if(message!=null&&NotifyMessage!=null){
                    object raw;message.TryGetValue("role",out raw);var role=JsonData.D(raw);
                    string kind=JsonData.S(message,"kind"),label=ActivityTitle(kind);
                    string detail=JsonData.S(role,"projectTitle")+" · "+(JsonData.S(role,"episodeNumber")!=""?"Серия "+JsonData.S(role,"episodeNumber")+" · ":"")+JsonData.S(role,"character");
                    string note=JsonData.S(message,"text");if(note!="")detail+="\n"+note;
                    if(detail.Length>220)detail=detail.Substring(0,217)+"…";
                    if(JsonData.N(message,"newCount")>1)detail+="\nЕщё уведомлений: "+(JsonData.N(message,"newCount")-1);
                    NotifyMessage(label,detail);
                }else if(oldView.Count>0&&(added>0||retakes>0)&&Notify!=null)Notify(added,retakes);
            }
            catch(CloudFault problem){
                lock(gate){
                    error=problem.Message;
                    if(problem.Status==401||problem.Status==403){session=new Dictionary<string,object>();try{File.Delete(sessionFile);mailbox.Clear();}catch{}}
                }
            }
            catch{lock(gate)error="Не удалось обновить роли. Показаны последние сохранённые назначения.";}
            finally{lock(gate)busy=false;Monitor.Exit(syncGate);}
        }
        // Used by Windows tray balloon notifications. Matches the web inbox labels.
        static string ActivityTitle(string kind){
            switch(kind){
                case "role_assigned":return "Новая роль";
                case "role_removed":return "Роль снята";
                case "role_changed":return "Изменение назначения";
                case "deadline_changed":return "Изменён срок сдачи";
                case "status_waiting":return "Ожидается запись";
                case "status_recording":return "Идёт запись";
                case "status_received":return "Запись получена";
                case "status_processing":return "Работа в обработке";
                case "status_processed":return "Обработка завершена";
                case "status_retake":return "Нужна перезапись";
                case "status_done":return "Работа принята";
                case "file_downloaded":return "Руководитель скачал запись";
                case "retake":return "Нужна перезапись";
                case "accepted":return "Роль принята";
                case "note":return "Замечание к роли";
                default:return "Уведомление от студии";
            }
        }
        public object Submit(string roleId){
            lock(gate){
                if(!Authenticated())throw new CloudFault(401,"login_required","Сначала войди в аккаунт.");
                object raw;session.TryGetValue("view",out raw);var view=JsonData.D(raw);
                if(!JsonData.B(view,"reviewApiAvailable"))throw new CloudFault(409,"server_outdated","Попроси руководителя обновить сервер до Cloud 0.3.0.");
                object feed;view.TryGetValue("feed",out feed);
                bool found=false;
                foreach(var item in JsonData.A(JsonData.D(feed),"roles"))if(JsonData.S(JsonData.D(item),"roleId")==roleId)found=true;
                if(!found)throw new CloudFault(404,"role_unavailable","Роль не найдена. Обнови проекты.");
                if(!mailbox.HasPendingRole(roleId))mailbox.Queue("submit",new Dictionary<string,object>{{"roleId",roleId},{"requestId",Guid.NewGuid().ToString("D")}});
            }
            ThreadPool.QueueUserWorkItem(delegate{Poll();});return Status();
        }
        public object ReadMessage(long id){mailbox.MarkRead(id);ThreadPool.QueueUserWorkItem(delegate{Poll();});return Status();}
        public object DeleteMessages(long[] ids,bool all){
            lock(gate){if(!Authenticated())throw new CloudFault(401,"login_required","Сначала войди в аккаунт.");}
            mailbox.Delete(ids,all);ThreadPool.QueueUserWorkItem(delegate{Poll();});return Status();
        }
        public object DismissFailures(){mailbox.DismissFailures();return Status();}
        public void Dispose(){if(timer!=null)timer.Dispose();transfers.Dispose();}
    }
}
