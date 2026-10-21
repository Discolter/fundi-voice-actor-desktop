using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;

namespace FundiVoice.Desktop {
    // Durable review outbox and notification cache. Cloud tokens never enter these payloads.
    public sealed class ReviewMailbox {
        readonly string path;
        readonly object gate=new object();
        Dictionary<string,object> data;
        public ReviewMailbox(string directory){
            path=Path.Combine(directory,"reviews.bin");
            data=PrivateFile.Read(path);
        }
        void Save(){PrivateFile.Save(path,data);}
        public bool HasOutbox{get{lock(gate)return JsonData.A(data,"outbox").Length>0;}}
        public void Bind(string server,string user){
            if(server==""||user=="")return;
            lock(gate){if(JsonData.S(data,"identity")!=server+"|"+user){data=new Dictionary<string,object>{{"identity",server+"|"+user}};Save();}}
        }
        public void Clear(){lock(gate){data=new Dictionary<string,object>();if(File.Exists(path))File.Delete(path);}}
        public void DismissFailures(){lock(gate){data["failed"]=new object[0];Save();}}
        public object View(){
            lock(gate)return new{unread=JsonData.N(data,"unread"),messages=JsonData.A(data,"messages"),
                pending=JsonData.A(data,"outbox"),failed=JsonData.A(data,"failed")};
        }
        public bool HasPendingRole(string roleId){
            lock(gate)return JsonData.A(data,"outbox").Any(raw=>{
                var item=JsonData.D(raw);object body;item.TryGetValue("body",out body);
                return JsonData.S(item,"operation")=="submit"&&JsonData.S(JsonData.D(body),"roleId")==roleId;
            });
        }
        public void Queue(string operation,Dictionary<string,object> body){
            lock(gate){
                var rows=JsonData.A(data,"outbox").ToList();
                if(rows.Count>=100)throw new CloudFault(409,"outbox_full","Сначала дождись отправки накопившихся сообщений.");
                if(operation=="submit"||operation=="feedback")data["failed"]=JsonData.A(data,"failed").Where(raw=>{
                    var item=JsonData.D(raw);object previous;item.TryGetValue("body",out previous);var prior=JsonData.D(previous);
                    return JsonData.S(item,"operation")!=operation||JsonData.S(prior,"roleId")!=JsonData.S(body,"roleId")||JsonData.S(prior,"actorId")!=JsonData.S(body,"actorId");
                }).ToArray();
                rows.Add(new Dictionary<string,object>{{"operation",operation},{"body",body},{"queuedAt",DateTime.UtcNow.ToString("o")}});
                data["outbox"]=rows.ToArray();Save();
            }
        }
        // Deletion is recipient-scoped on Cloud 0.3.1; keep local tombstones until acknowledged.
        public void Delete(long[] ids,bool all){
            if(!all&&(ids==null||ids.Length==0||ids.Length>100||ids.Any(id=>id<=0)))
                throw new CloudFault(400,"invalid_messages","Выбери от 1 до 100 уведомлений.");
            lock(gate){
                var rows=JsonData.A(data,"outbox").ToList();
                if(rows.Count>=100)throw new CloudFault(409,"outbox_full","Сначала дождись отправки накопившихся сообщений.");
                var selected=new HashSet<long>(all?JsonData.A(data,"messages").Select(raw=>JsonData.N(JsonData.D(raw),"id")):ids);
                var removed=JsonData.A(data,"messages").Select(JsonData.D).Where(item=>all||selected.Contains(JsonData.N(item,"id"))).ToList();
                data["messages"]=JsonData.A(data,"messages").Where(raw=>!all&&!selected.Contains(JsonData.N(JsonData.D(raw),"id"))).ToArray();
                data["unread"]=Math.Max(0,JsonData.N(data,"unread")-removed.Count(item=>!JsonData.B(item,"read")));
                var deleted=new HashSet<long>(JsonData.A(data,"deletedIds").Select(v=>Convert.ToInt64(v)));
                foreach(var id in selected)deleted.Add(id);
                data["deletedIds"]=deleted.OrderBy(v=>v).ToArray();
                if(all)data["deletedThrough"]=Math.Max(JsonData.N(data,"deletedThrough"),JsonData.N(data,"cursor"));
                var body=all?new Dictionary<string,object>{{"all",true}}:new Dictionary<string,object>{{"ids",ids}};
                rows.Add(new Dictionary<string,object>{{"operation","delete"},{"body",body},{"queuedAt",DateTime.UtcNow.ToString("o")}});
                data["outbox"]=rows.ToArray();Save();
            }
        }
        public void MarkRead(long id){
            if(id<=0)return;
            lock(gate){
                bool changed=false;
                data["messages"]=JsonData.A(data,"messages").Select(raw=>{
                    var item=JsonData.D(raw);
                    if(JsonData.N(item,"id")!=id||JsonData.B(item,"read"))return raw;
                    changed=true;var copy=new Dictionary<string,object>(item);copy["read"]=true;return (object)copy;
                }).ToArray();
                if(changed)data["unread"]=Math.Max(0,JsonData.N(data,"unread")-1);
                var rows=JsonData.A(data,"outbox").ToList();
                if(rows.Count>=100)throw new CloudFault(409,"outbox_full","Сначала дождись отправки накопившихся сообщений.");
                rows.Add(new Dictionary<string,object>{{"operation","read"},{"body",new Dictionary<string,object>{{"ids",new long[]{id}}}},
                    {"queuedAt",DateTime.UtcNow.ToString("o")}});
                data["outbox"]=rows.ToArray();Save();
            }
        }
        public int Drain(Func<string,string,object,Dictionary<string,object>> send,bool studio){
            int sent=0;
            for(int index=0;index<10;index++){
                object first;
                lock(gate){var items=JsonData.A(data,"outbox");if(items.Length==0)break;first=items[0];}
                var row=JsonData.D(first);string operation=JsonData.S(row,"operation");object body;row.TryGetValue("body",out body);
                try{send((studio?"/v1/studio/":"/v1/actor/")+(operation=="read"?"notifications/read":operation=="delete"?"notifications/delete":operation),"POST",body);}
                catch(CloudFault problem){
                    if(problem.Code=="server_outdated"||problem.Status==401||problem.Status==403||problem.Status>=500||problem.Status==429||problem.Status==0)throw;
                    lock(gate){
                        var failed=JsonData.A(data,"failed").ToList();var copy=new Dictionary<string,object>(row);copy["error"]=problem.Message;
                        failed.Add(copy);data["failed"]=failed.Skip(Math.Max(0,failed.Count-20)).ToArray();
                    }
                }
                lock(gate){
                    var items=JsonData.A(data,"outbox").ToList();
                    if(items.Count>0&&Object.ReferenceEquals(items[0],first))items.RemoveAt(0);
                    data["outbox"]=items.ToArray();Save();
                }
                sent++;
            }
            return sent;
        }
        public Dictionary<string,object> Fetch(Func<string,string,object,Dictionary<string,object>> send,bool studio){
            Dictionary<string,object> latest=null;
            int added=0;
            for(int page=0;page<5;page++){
                long cursor;lock(gate)cursor=JsonData.N(data,"cursor");
                var response=send((studio?"/v1/studio/notifications?after=":"/v1/actor/notifications?after=")+cursor,"GET",null);
                lock(gate){
                    var messages=JsonData.A(data,"messages").Select(JsonData.D).ToDictionary(item=>JsonData.N(item,"id"));
                    var deleted=new HashSet<long>(JsonData.A(data,"deletedIds").Select(v=>Convert.ToInt64(v)));
                    long deletedThrough=JsonData.N(data,"deletedThrough");
                    foreach(var raw in JsonData.A(response,"messages")){
                        var item=JsonData.D(raw);long id=JsonData.N(item,"id");
                        if(deleted.Contains(id)||id<=deletedThrough)continue;
                        if(id>cursor&&!messages.ContainsKey(id)&&!JsonData.B(item,"read")){latest=item;added++;}
                        messages[id]=item;
                    }
                    var readIds=new HashSet<long>();
                    foreach(var raw in JsonData.A(data,"outbox")){
                        var row=JsonData.D(raw);object body;row.TryGetValue("body",out body);
                        if(JsonData.S(row,"operation")=="read")foreach(var id in JsonData.A(JsonData.D(body),"ids")){long parsed;if(Int64.TryParse(Convert.ToString(id),out parsed))readIds.Add(parsed);}
                    }
                    var unreadIds=new HashSet<long>(JsonData.A(response,"unreadIds").Select(id=>Convert.ToInt64(id)));
                    bool authoritative=response.ContainsKey("unreadIds");
                    data["messages"]=messages.Values.Where(item=>!deleted.Contains(JsonData.N(item,"id"))&&JsonData.N(item,"id")>deletedThrough).Select(item=>{
                        long id=JsonData.N(item,"id");
                        if(!authoritative&&!readIds.Contains(id))return item;
                        var copy=new Dictionary<string,object>(item);copy["read"]=readIds.Contains(id)||!unreadIds.Contains(id);return copy;
                    }).Where(item=>!JsonData.B(item,"read")||JsonData.N(item,"id")>=Math.Max(0,JsonData.N(response,"after")-2000))
                        .OrderBy(item=>JsonData.N(item,"id")).Select(item=>(object)item).ToArray();
                    data["cursor"]=JsonData.N(response,"after");
                    data["unread"]=Math.Max(0,JsonData.N(response,"unread")-readIds.Count(id=>unreadIds.Contains(id))
                        -unreadIds.Count(id=>deleted.Contains(id)||id<=deletedThrough));Save();
                }
                if(!JsonData.B(response,"hasMore"))break;
            }
            if(latest!=null){var copy=new Dictionary<string,object>(latest);copy["newCount"]=added;return copy;}
            return null;
        }
    }
}
