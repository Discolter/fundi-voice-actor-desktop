using System;
using System.IO;
using System.Collections.Generic;
using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using FundiVoice.Desktop;

namespace FundiVoice {
    public sealed partial class ActorCloud {
        readonly FileJobs transfers=new FileJobs();
        object[] recordingFiles=new object[0];
        long usedBytes,quotaBytes=9L*1024*1024*1024;
        bool fileApiAvailable;
        string fileError="";
        void RotateAccess(){
            string server,refresh;
            lock(gate){server=JsonData.S(session,"server");refresh=JsonData.S(session,"refreshToken");}
            var rotated=CloudHttp.Request(server,"/v1/actor/refresh","POST",new{refreshToken=refresh},null);
            lock(gate){
                session["accessToken"]=JsonData.S(rotated,"accessToken");session["refreshToken"]=JsonData.S(rotated,"refreshToken");
                session["accessExpiresAt"]=JsonData.S(rotated,"accessExpiresAt");PrivateFile.Save(sessionFile,session);
            }
        }
        Dictionary<string,object> FileRequest(string path,string method,object body){
            lock(syncGate){
                string server,access,expires;
                lock(gate){
                    if(!Authenticated())throw new CloudFault(401,"login_required","Сначала войди в аккаунт.");
                    server=JsonData.S(session,"server");expires=JsonData.S(session,"accessExpiresAt");
                }
                DateTime until;
                if(!DateTime.TryParse(expires,CultureInfo.InvariantCulture,DateTimeStyles.RoundtripKind,out until)||until.ToUniversalTime()<DateTime.UtcNow.AddMinutes(1))RotateAccess();
                lock(gate)access=JsonData.S(session,"accessToken");
                try{return CloudHttp.Request(server,path,method,body,access);}
                catch(CloudFault problem){
                    if(problem.Status!=401)throw;RotateAccess();lock(gate)access=JsonData.S(session,"accessToken");
                    return CloudHttp.Request(server,path,method,body,access);
                }
            }
        }
        void RefreshFiles(bool required){
            try{
                var response=FileRequest("/v1/actor/files","GET",null);
                lock(gate){recordingFiles=JsonData.A(response,"files");usedBytes=JsonData.N(response,"usedBytes");
                    quotaBytes=JsonData.N(response,"quotaBytes");fileApiAvailable=true;fileError="";}
            }catch(CloudFault problem){
                lock(gate){if(problem.Status==404)fileApiAvailable=false;
                    fileError=problem.Status==404?"Для загрузки записей нужен Fundi Voice Cloud 0.4.0.":problem.Message;}
                if(required)throw;
            }
        }
        public object FilesNow(){RefreshFiles(true);return Status();}
        public void RequireUploadRole(string roleId){
            lock(gate){
                if(!Authenticated())throw new CloudFault(401,"login_required","Сначала войди в аккаунт.");
                object raw;session.TryGetValue("view",out raw);var view=JsonData.D(raw);
                object feed;view.TryGetValue("feed",out feed);
                foreach(var item in JsonData.A(JsonData.D(feed),"roles"))if(JsonData.S(JsonData.D(item),"roleId")==roleId)return;
            }
            throw new CloudFault(404,"role_unavailable","Роль больше не назначена тебе. Обнови проекты.");
        }
        public object UploadRecording(string roleId,string path){
            RequireUploadRole(roleId);
            string name=Path.GetFileName(path);R2Transfer.SafeName(name);
            if(name!=R2Transfer.SafeName(name))throw new CloudFault(400,"invalid_file_name","Переименуй файл без специальных символов и повтори.");
            long size=new FileInfo(path).Length;
            if(size<1||size>R2Transfer.MaximumBytes)throw new CloudFault(400,"invalid_file_size","Выбери запись от 1 байта до 2 ГиБ.");
            lock(syncGate)transfers.Start("upload",name,size,roleId,delegate(TransferJob job){
                // Hold a read-only handle through confirmation: an editor cannot change the
                // bytes after their fingerprint has selected the persistent reservation.
                using(var input=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.Read)){
                    if(input.Length!=size)throw new CloudFault(409,"file_changed","Файл изменился. Закончи экспорт записи и выбери его заново.");
                    job.SetPhase("Проверяем запись…");
                    string fingerprint=UploadFingerprint(input,roleId,name,job);
                    string journalPath=sessionFile+".uploads";
                    var journal=PrivateFile.Read(journalPath);
                    object raw;bool retry=journal.TryGetValue(fingerprint,out raw);
                    var attempt=JsonData.D(raw);
                    if(!retry){
                        attempt=new Dictionary<string,object>{{"requestId",Guid.NewGuid().ToString("D")}};
                        // Persist before POST: a lost response must reuse the same request ID.
                        journal[fingerprint]=attempt;PrivateFile.Save(journalPath,journal);
                    }
                    job.Check();job.SetPhase(retry?"Проверяем предыдущую попытку…":"Резервируем место…");
                    var begun=FileRequest("/v1/actor/files/begin","POST",new{roleId=roleId,fileName=name,size=size,requestId=JsonData.S(attempt,"requestId")});
                    string fileId=JsonData.S(begun,"fileId");job.SetFileId(fileId);
                    attempt["fileId"]=fileId;PrivateFile.Save(journalPath,journal);job.Check();
                    bool uploaded=JsonData.B(begun,"uploaded");
                    if(!uploaded&&retry)uploaded=VerifyRecording(fileId);
                    if(!uploaded){
                        try{R2Transfer.Upload(JsonData.S(begun,"uploadUrl"),path,size,job);}
                        catch(WebException problem){
                            string message=R2Transfer.NetworkMessage(problem);
                            job.Check();job.SetPhase("Связь прервалась. Проверяем файл в облаке…");
                            if(!VerifyRecording(fileId))throw new CloudFault(0,"upload_interrupted",message+" Повторная попытка использует прежний резерв места.");
                            uploaded=true;
                        }
                        catch(IOException){
                            job.Check();job.SetPhase("Проверяем файл в облаке…");
                            if(!VerifyRecording(fileId))throw new CloudFault(0,"upload_interrupted","Передача прервалась. Выбери тот же файл повторно: новый резерв места не потребуется.");
                            uploaded=true;
                        }
                    }
                    job.Progress(size);job.Commit();
                    if(!uploaded&&!VerifyRecording(fileId))throw new CloudFault(502,"upload_incomplete","Сервер ещё не подтвердил запись. Выбери тот же файл повторно или нажми «Проверить загрузку».");
                    // A review notification is queued only after R2 size verification succeeds.
                    Submit(roleId);RefreshFiles(false);
                }
            });
            return Status();
        }
        string UploadFingerprint(Stream input,string roleId,string name,TransferJob job){
            using(var hash=SHA256.Create()){
                var buffer=new byte[128*1024];int count;
                while((count=input.Read(buffer,0,buffer.Length))>0){job.Check();hash.TransformBlock(buffer,0,count,buffer,0);}
                hash.TransformFinalBlock(new byte[0],0,0);
                string scope;
                lock(gate)scope=JsonData.S(session,"server")+"\n"+JsonData.S(session,"username").ToLowerInvariant()+"\n"+roleId+"\n"+name+"\n"+Convert.ToBase64String(hash.Hash);
                hash.Initialize();return Convert.ToBase64String(hash.ComputeHash(Encoding.UTF8.GetBytes(scope)));
            }
        }
        bool VerifyRecording(string fileId){
            try{return JsonData.B(FileRequest("/v1/actor/files/complete","POST",new{fileId=fileId}),"uploaded");}
            catch(CloudFault problem){if(problem.Status==409&&problem.Code=="upload_incomplete")return false;throw;}
        }
        public object ConfirmRecording(string fileId){
            if(transfers.Busy)throw new CloudFault(409,"transfer_busy","Сначала заверши или отмени текущую передачу.");
            Dictionary<string,object> file=null;
            lock(gate){foreach(var raw in recordingFiles){var item=JsonData.D(raw);if(JsonData.S(item,"fileId")==fileId){file=item;break;}}}
            if(file==null)throw new CloudFault(404,"file_missing","Файл не найден. Обнови список записей.");
            string roleId=JsonData.S(file,"roleId");RequireUploadRole(roleId);
            var result=FileRequest("/v1/actor/files/complete","POST",new{fileId=fileId});
            if(!JsonData.B(result,"uploaded"))throw new CloudFault(409,"upload_incomplete","Загрузка ещё не подтверждена.");
            Submit(roleId);RefreshFiles(false);return Status();
        }
        public object DeleteRecording(string fileId){
            lock(syncGate){
                if(transfers.Busy)throw new CloudFault(409,"transfer_busy","Сначала заверши или отмени текущую передачу, затем удали файл.");
                FileRequest("/v1/actor/files/delete","POST",new{fileId=fileId});
                string path=sessionFile+".uploads";
                var journal=PrivateFile.Read(path);var remove=new List<string>();
                foreach(var item in journal)if(JsonData.S(JsonData.D(item.Value),"fileId")==fileId)remove.Add(item.Key);
                foreach(string key in remove)journal.Remove(key);
                PrivateFile.Save(path,journal);RefreshFiles(false);return Status();
            }
        }
        public object CancelTransfer(){transfers.Cancel();return Status();}
    }
}
