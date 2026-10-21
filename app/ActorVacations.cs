// Vacations are server-owned. This client does not modify roles or the local mailbox.
using System;
using System.Collections.Generic;
using FundiVoice.Desktop;

namespace FundiVoice {
    public sealed partial class ActorCloud {
        object vacationData=new {current=(object)null,history=new object[0]};
        string vacationError="";
        bool vacationApiAvailable=false;

        void ClearVacation(){vacationData=new {current=(object)null,history=new object[0]};vacationError="";vacationApiAvailable=false;}

        void RefreshVacation(string server,string token){
            try{
                var remote=CloudHttp.Request(server,"/v1/actor/vacation","GET",null,token);
                lock(gate){vacationData=remote;vacationError="";vacationApiAvailable=true;}
            }catch(CloudFault problem){
                // An old/offline Cloud must never hide the actor's already assigned roles.
                lock(gate){vacationError=problem.Message;vacationApiAvailable=false;}
            }catch{
                lock(gate){vacationError="Сведения об отпуске пока не обновились.";}
            }
        }
        object VacationAction(string path,object body){
            // Poll rotates expiring bearer credentials, so we never store any token in the web UI.
            Poll();
            lock(syncGate){
                string server,access;
                lock(gate){
                    if(!Authenticated())throw new CloudFault(401,"not_authenticated","Сначала войди в аккаунт актёра.");
                    server=JsonData.S(session,"server");access=JsonData.S(session,"accessToken");
                }
                if(access=="")throw new CloudFault(401,"not_authenticated","Сеанс завершён. Войди заново.");
                CloudHttp.Request(server,path,"POST",body,access);
                // Re-read authoritative dates and history from the server after mutation.
                var remote=CloudHttp.Request(server,"/v1/actor/vacation","GET",null,access);
                lock(gate){vacationData=remote;vacationError="";vacationApiAvailable=true;}
                return Status();
            }
        }
        public object StartVacation(Dictionary<string,object> request){
            string start=JsonData.Date(JsonData.S(request,"startDate"));
            string end=JsonData.S(request,"endDate");
            if(start==""||(end!=""&&JsonData.Date(end)==""))
                throw new CloudFault(400,"invalid_dates","Проверь даты отпуска.");
            string zone=JsonData.S(request,"timeZone"),reason=JsonData.S(request,"reason");
            if(zone.Length<1||zone.Length>64||reason.Length>800)
                throw new CloudFault(400,"invalid_vacation","Проверь часовой пояс и комментарий.");
            return VacationAction("/v1/actor/vacation/start",new{startDate=start,endDate=end==""?null:end,reason=reason,timeZone=zone});
        }
        public object UpdateVacation(Dictionary<string,object> request){
            string end=JsonData.S(request,"endDate"),reason=JsonData.S(request,"reason");
            if((end!=""&&JsonData.Date(end)=="")||reason.Length>800)
                throw new CloudFault(400,"invalid_vacation","Проверь срок возвращения и комментарий.");
            return VacationAction("/v1/actor/vacation/update",new{endDate=end==""?null:end,reason=reason});
        }
        public object EndVacation(){return VacationAction("/v1/actor/vacation/end",new{});}
    }
}
