// Shared Windows bridge. No cloud credentials are exposed to the web UI or workspace.json.
using System;
using System.IO;
using System.Net;
using System.Text;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Security.Cryptography;
using System.Web.Script.Serialization;

namespace FundiVoice.Desktop {
    public sealed class CloudFault : Exception {
        public readonly int Status;
        public readonly string Code;
        public CloudFault(int status,string code,string message):base(message){Status=status;Code=code;}
    }
    public static class JsonData {
        public static JavaScriptSerializer Json(){return new JavaScriptSerializer{MaxJsonLength=16*1024*1024,RecursionLimit=100};}
        public static Dictionary<string,object> D(object value){return value as Dictionary<string,object> ?? new Dictionary<string,object>();}
        public static string S(Dictionary<string,object> value,string key){object found;return value.TryGetValue(key,out found)&&found!=null?Convert.ToString(found,CultureInfo.InvariantCulture):"";}
        public static bool B(Dictionary<string,object> value,string key){object found;return value.TryGetValue(key,out found)&&found is bool&&(bool)found;}
        public static long N(Dictionary<string,object> value,string key){long result;return Int64.TryParse(S(value,key),out result)?result:0;}
        public static object[] A(Dictionary<string,object> value,string key){object found;if(!value.TryGetValue(key,out found)||!(found is IEnumerable)||found is string)return new object[0];var result=new List<object>();foreach(var item in (IEnumerable)found)result.Add(item);return result.ToArray();}
        public static Dictionary<string,object> Read(string path){return File.Exists(path)?D(Json().DeserializeObject(File.ReadAllText(path,Encoding.UTF8))):new Dictionary<string,object>();}
        public static void AtomicText(string path,string contents){
            string temp=path+"."+Guid.NewGuid().ToString("N")+".tmp";
            try{File.WriteAllText(temp,contents,new UTF8Encoding(false));if(File.Exists(path))File.Replace(temp,path,null,true);else File.Move(temp,path);}
            finally{try{File.Delete(temp);}catch{}}
        }
        public static string RandomToken(){var bytes=new byte[32];using(var random=RandomNumberGenerator.Create())random.GetBytes(bytes);return BitConverter.ToString(bytes).Replace("-","").ToLowerInvariant();}
        public static string Digest(string value){using(var hash=SHA256.Create())return Convert.ToBase64String(hash.ComputeHash(Encoding.UTF8.GetBytes(value)));}
        public static string Date(string value){DateTime day;return DateTime.TryParseExact(value,"yyyy-MM-dd",CultureInfo.InvariantCulture,DateTimeStyles.None,out day)?value:"";}
    }
    public static class PrivateFile {
        public static Dictionary<string,object> Read(string path){
            if(!File.Exists(path))return new Dictionary<string,object>();
            try{return JsonData.D(JsonData.Json().DeserializeObject(Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(path),null,DataProtectionScope.CurrentUser))));}
            catch{throw new CloudFault(0,"local_secret_unreadable","Windows не смогла открыть сохранённый сеанс. Подключись заново на этом компьютере.");}
        }
        public static void Save(string path,Dictionary<string,object> value){
            string temp=path+"."+Guid.NewGuid().ToString("N")+".tmp";
            try{File.WriteAllBytes(temp,ProtectedData.Protect(Encoding.UTF8.GetBytes(JsonData.Json().Serialize(value)),null,DataProtectionScope.CurrentUser));if(File.Exists(path))File.Replace(temp,path,null,true);else File.Move(temp,path);}
            finally{try{File.Delete(temp);}catch{}}
        }
    }
    public static class CloudHttp {
        public const string DefaultServer="https://fundi-voice-cloud.onrender.com";
        public static string Server(string raw){
            Uri value;
            if(!Uri.TryCreate(raw.Trim(),UriKind.Absolute,out value)||value.Scheme!="https"||
                value.UserInfo!=""||value.Query!=""||value.Fragment!=""||value.AbsolutePath!="/"||
                value.IsLoopback||value.Host.IndexOf('.')<0)
                throw new CloudFault(400,"invalid_server","Укажи HTTPS-адрес сервера, например "+DefaultServer);
            IPAddress parsed;if(IPAddress.TryParse(value.Host,out parsed))throw new CloudFault(400,"invalid_server","Укажи доменное имя HTTPS-сервера.");
            return value.GetLeftPart(UriPartial.Authority).TrimEnd(new[]{'/'});
        }
        public static Dictionary<string,object> Request(string server,string path,string method,object body,string token){
            // Respect the OS TLS policy; never weaken certificate verification.
            ServicePointManager.SecurityProtocol=SecurityProtocolType.SystemDefault;
            var request=(HttpWebRequest)WebRequest.Create(Server(server)+path);
            request.Method=method;request.Timeout=75000;request.ReadWriteTimeout=75000;
            request.AllowAutoRedirect=false;request.KeepAlive=false;
            request.Accept="application/json";request.UserAgent="FundiVoice-Windows/1.6";
            if(!String.IsNullOrEmpty(token))request.Headers["Authorization"]="Bearer "+token;
            if(body!=null){
                byte[] bytes=Encoding.UTF8.GetBytes(JsonData.Json().Serialize(body));
                if(bytes.Length>3*1024*1024)throw new CloudFault(413,"payload_too_large","Слишком много данных для одной публикации. Уменьши число активных проектов.");
                request.ContentType="application/json; charset=utf-8";request.ContentLength=bytes.Length;
                try{using(var output=request.GetRequestStream())output.Write(bytes,0,bytes.Length);}
                catch(WebException error){throw Network(error);}
            }
            HttpWebResponse response;
            try{response=(HttpWebResponse)request.GetResponse();}
            catch(WebException error){response=error.Response as HttpWebResponse;if(response==null)throw Network(error);}
            using(response){
                string raw;
                using(var input=response.GetResponseStream())
                using(var memory=new MemoryStream()){
                    var buffer=new byte[16384];int count;
                    while((count=input.Read(buffer,0,buffer.Length))>0){if(memory.Length+count>10*1024*1024)throw new CloudFault(502,"invalid_response","Ответ сервера слишком большой.");memory.Write(buffer,0,count);}
                    raw=Encoding.UTF8.GetString(memory.ToArray());
                }
                Dictionary<string,object> result;
                try{result=JsonData.D(JsonData.Json().DeserializeObject(raw));}
                catch{
                    if((int)response.StatusCode==404)throw new CloudFault(404,"server_outdated","Сначала загрузи обновление Fundi Voice Cloud 0.3.0 в GitHub.");
                    throw new CloudFault((int)response.StatusCode,"invalid_response","Сервер запускается или вернул неполный ответ. Повтори через минуту.");
                }
                int status=(int)response.StatusCode;
                if(status<200||status>=300){
                    string message=JsonData.S(result,"message");if(message.Length==0||message.Length>500)message="Сервер временно недоступен. Повтори позже.";
                    throw new CloudFault(status,JsonData.S(result,"error"),message);
                }
                return result;
            }
        }
        static CloudFault Network(WebException error){
            if(error.Status==WebExceptionStatus.TrustFailure||error.Status==WebExceptionStatus.SecureChannelFailure)
                return new CloudFault(0,"tls_failed","Windows не смогла проверить HTTPS-сертификат сервера. Проверь дату Windows и соединение.");
            return new CloudFault(0,"offline","Нет ответа от сервера. Изменения сохранены на компьютере; повторим подключение.");
        }
    }
    public static class ActorProjection {
        static string S(Dictionary<string,object> value,string key){return JsonData.S(value,key);}
        public static object[] Build(Dictionary<string,object> state){
            var actors=new SortedDictionary<string,Dictionary<string,object>>(StringComparer.Ordinal);
            var roles=new Dictionary<string,List<object>>(StringComparer.Ordinal);
            foreach(var raw in JsonData.A(state,"actors")){
                var actor=JsonData.D(raw);string id=S(actor,"id");
                if(id=="")continue;
                actors[id]=actor;roles[id]=new List<object>();
            }
            foreach(var rawProject in JsonData.A(state,"projects")){
                var project=JsonData.D(rawProject);if(JsonData.B(project,"archived"))continue;
                foreach(var rawEpisode in JsonData.A(project,"episodes")){
                    var episode=JsonData.D(rawEpisode);
                    foreach(var rawRole in JsonData.A(episode,"roles")){
                        var role=JsonData.D(rawRole);string actorId=S(role,"actorId");
                        if(!actors.ContainsKey(actorId)||!JsonData.B(actors[actorId],"actorAccess"))continue;
                        string due=JsonData.Date(S(role,"due"));if(due=="")due=JsonData.Date(S(episode,"due"));
                        roles[actorId].Add(new Dictionary<string,object>{
                            {"roleId",S(role,"id")},{"projectId",S(project,"id")},{"projectTitle",S(project,"title")},{"season",S(project,"season")},
                            {"episodeId",S(episode,"id")},{"episodeNumber",S(episode,"number")},{"episodeTitle",S(episode,"title")},
                            {"character",S(role,"character")},{"status",S(role,"status")},{"due",due}
                        });
                    }
                }
            }
            var result=new List<object>();
            foreach(var actor in actors){
                bool enabled=JsonData.B(actor.Value,"actorAccess");
                roles[actor.Key].Sort(delegate(object a,object b){return String.CompareOrdinal(S(JsonData.D(a),"roleId"),S(JsonData.D(b),"roleId"));});
                result.Add(new Dictionary<string,object>{{"actorId",actor.Key},{"enabled",enabled},
                    {"feed",enabled?new Dictionary<string,object>{{"version",1},{"actorId",actor.Key},{"roles",roles[actor.Key].ToArray()}}:null}});
            }
            return result.ToArray();
        }
    }
}
