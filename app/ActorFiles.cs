using System;
using System.IO;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
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
        // File lists and finished transfers belong to one account, including when
        // the next user's file refresh fails. Never show a previous actor's cache.
        void ClearAccountCache(){
            recordingFiles=new object[0];usedBytes=0;quotaBytes=9L*1024*1024*1024;
            fileApiAvailable=false;fileError="";transfers.ClearCompleted();ClearVacation();
        }
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
        public object Casting(Dictionary<string,object> body){
            string action=JsonData.S(body,"action"),path;
            if(action=="")path="/v1/actor/casting";
            else if(action=="files/begin"||action=="files/download")path="/v1/actor/casting/"+action;
            else if(action=="multipart/begin"||action=="multipart/complete")path="/v1/actor/files/"+action;
            else if(action=="files/delete")path="/v1/actor/files/delete";
            else throw new CloudFault(400,"invalid_casting_action","Неизвестное действие кастинга.");
            return FileRequest(path,action==""?"GET":"POST",action==""?null:JsonData.D(body.ContainsKey("data")?body["data"]:null));
        }
        public object Software(){
            return FileRequest("/v1/actor/software","GET",null);
        }
        public object SoftwareDownload(Dictionary<string,object> body){
            Guid id;
            if(!Guid.TryParseExact(JsonData.S(body,"id"),"D",out id))
                throw new CloudFault(400,"invalid_resource","Неверный файл.");
            return FileRequest("/v1/actor/software/download","POST",new{id=id.ToString("D")});
        }
        public object CastingPart(string fileId,string part,byte[] bytes){
            Guid id;int number;
            if(!Guid.TryParseExact(fileId,"D",out id)||!Int32.TryParse(part,out number)||number<1||number>1152||bytes.Length<1||bytes.Length>8*1024*1024)
                throw new CloudFault(400,"invalid_part","Неверная часть пробы.");
            return FileRequest("/v1/actor/files/"+id.ToString("D")+"/parts/"+number.ToString(CultureInfo.InvariantCulture),"PUT",bytes);
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
        public object UploadRecordings(string roleId,string[] roleIds,string[] paths){
            if(paths.Length<1||paths.Length>1000||roleIds.Length<1||roleIds.Length>20000||
                !roleIds.Contains(roleId)||roleIds.Distinct(StringComparer.Ordinal).Count()!=roleIds.Length||
                (roleIds.Length>1&&paths.Length!=1))
                throw new CloudFault(400,"invalid_submission","Выбери записи для одной роли или один файл для нескольких ролей серии.");
            if(paths.Distinct(StringComparer.OrdinalIgnoreCase).Count()!=paths.Length)
                throw new CloudFault(400,"invalid_file","Один файл можно выбрать только один раз.");
            var files=paths.Select(path=>new FileInfo(path)).ToArray();
            var sizes=files.Select(file=>{
                if(file.Name!=R2Transfer.SafeName(file.Name))
                    throw new CloudFault(400,"invalid_file_name","Переименуй файл без специальных символов и повтори.");
                if(file.Length<1||file.Length>R2Transfer.MaximumBytes)
                    throw new CloudFault(400,"invalid_file_size","Выбери запись от 1 байта до 2 ГиБ.");
                return file.Length;
            }).ToArray();
            bool batch=files.Length>1||roleIds.Length>1;
            lock(syncGate){
                foreach(var id in roleIds)RequireUploadRole(id);
                if(batch){
                    lock(gate){
                        object view;session.TryGetValue("view",out view);
                        if(!JsonData.B(JsonData.D(view),"recordingBatchesAvailable"))
                            throw new CloudFault(409,"server_outdated","Сервер ещё обновляется. Попробуй чуть позже.");
                    }
                }
                string label=files.Length==1?files[0].Name:"Файлов: "+files.Length;
                transfers.Start("upload",label,sizes.Sum(),roleId,delegate(TransferJob job){
                    long sent=0;
                    var fileIds=new string[files.Length];
                    for(int index=0;index<files.Length;index++){
                        job.SetProgressOffset(sent);
                        fileIds[index]=PrepareRecording(roleId,files[index],sizes[index],job);
                        sent+=sizes[index];
                    }
                    job.Commit();
                    job.SetPhase(roleIds.Length==1?"Сдаём роль…":"Сдаём выбранные роли…");
                    if(batch){
                        string requestId=fileIds.OrderBy(id=>id,StringComparer.Ordinal).First();
                        FileRequest("/v1/actor/submit","POST",new{roleId=roleId,roleIds=roleIds,fileIds=fileIds,requestId=requestId});
                    }else SubmitRecording(roleId,fileIds[0]);
                    ForgetUploads(fileIds);
                    Poll();
                },roleIds);
            }
            return Status();
        }
        string PrepareRecording(string roleId,FileInfo file,long size,TransferJob job){
            // Keep a read handle open from fingerprinting through verification.
            string name=file.Name,path=file.FullName;
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
                    // Persist before POST so a lost response reuses the original reservation.
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
                job.Progress(size);
                if(!uploaded&&!VerifyRecording(fileId))
                    throw new CloudFault(502,"upload_incomplete","Сервер ещё не подтвердил запись. Выбери те же файлы повторно.");
                job.Check();
                return fileId;
            }
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
        void SubmitRecording(string roleId,string fileId){
            bool supported;
            lock(gate){
                object view;session.TryGetValue("view",out view);
                supported=JsonData.B(JsonData.D(view),"submissionActionsAvailable");
            }
            if(supported)
                FileRequest("/v1/actor/submit","POST",new{roleId=roleId,fileId=fileId,requestId=fileId});
            else Submit(roleId,false);
        }
        public object ConfirmRecording(string fileId){
            if(transfers.Busy)throw new CloudFault(409,"transfer_busy","Сначала заверши или отмени текущую передачу.");
            Dictionary<string,object> file=null;
            lock(gate){foreach(var raw in recordingFiles){var item=JsonData.D(raw);if(JsonData.S(item,"fileId")==fileId){file=item;break;}}}
            if(file==null)throw new CloudFault(404,"file_missing","Файл не найден. Обнови список записей.");
            string roleId=JsonData.S(file,"roleId");RequireUploadRole(roleId);
            var result=FileRequest("/v1/actor/files/complete","POST",new{fileId=fileId});
            if(!JsonData.B(result,"uploaded"))throw new CloudFault(409,"upload_incomplete","Загрузка ещё не подтверждена.");
            SubmitRecording(roleId,fileId);ForgetUploads(new[]{fileId});Poll();return Status();
        }
        void ForgetUploads(string[] fileIds){
            string path=sessionFile+".uploads";
            var journal=PrivateFile.Read(path);var remove=new List<string>();
            foreach(var item in journal)if(fileIds.Contains(JsonData.S(JsonData.D(item.Value),"fileId")))remove.Add(item.Key);
            if(remove.Count==0)return;
            foreach(string key in remove)journal.Remove(key);
            PrivateFile.Save(path,journal);
        }
        public object DeleteRecording(string fileId){
            lock(syncGate){
                if(transfers.Busy)throw new CloudFault(409,"transfer_busy","Сначала заверши или отмени текущую передачу, затем удали файл.");
                FileRequest("/v1/actor/files/delete","POST",new{fileId=fileId});
                ForgetUploads(new[]{fileId});RefreshFiles(false);return Status();
            }
        }
        public object CancelTransfer(){transfers.Cancel();return Status();}
    }
}

