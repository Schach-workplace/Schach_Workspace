import type { Task } from '../types';
export function localDeadline(instant: string, zone: string): string {
 const p=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant));
 const get=(kind:string)=>p.find(v=>v.type===kind)?.value;
 return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
// Enumerate possible UTC offsets around the chosen wall time. A gap has zero
// candidates; a fold has two and requires the user to select an instant.
export function deadlineCandidates(local:string,zone:string):string[]{
 try{new Intl.DateTimeFormat('en',{timeZone:zone})}catch{return []}
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return [];
 const anchor=Date.parse(local+':00Z'); if(!Number.isFinite(anchor))return [];
 const candidates:string[]=[];
 for(let minutes=-15*60;minutes<=15*60;minutes+=15){
  const instant=new Date(anchor+minutes*60000).toISOString();
  if(localDeadline(instant,zone)===local)candidates.push(instant);
 }
 return candidates;
}
function dateInZone(instant:Date,zone:string){return localDeadline(instant.toISOString(),zone).slice(0,10)}
export function isTaskOverdue(task:Task,now:Date,zone:string):boolean{
 if(['done','cancelled'].includes(task.status))return false;
 if(task.deadlineMode==='timed')return !!task.dueAt&&now.getTime()>Date.parse(task.dueAt);
 return !!task.dueDate&&task.dueDate<dateInZone(now,zone);
}
export function originalDeadlineMet(task:Task,zone:string):boolean{
 if(task.originalDeadlineMode==='timed')return !!task.originalDueAt&&Date.parse(task.completedAt)<=Date.parse(task.originalDueAt);
 return !!task.originalDueDate&&dateInZone(new Date(task.completedAt),zone)<=task.originalDueDate;
}
export function deadlineChanged(a:Partial<Task>,b:Partial<Task>):boolean{
 return a.dueDate!==b.dueDate||(a.deadlineMode??'all_day')!==(b.deadlineMode??'all_day')||(a.dueAt??'')!==(b.dueAt??'')||(a.dueTimezone??'')!==(b.dueTimezone??'');
}
export function validateDeadline(task:Partial<Task>):void{
 if((task.deadlineMode??'all_day')==='all_day'){if(task.dueAt||task.dueTimezone)throw new Error('All-day commitments cannot include a time.');return;}
 if(task.recurrence&&task.recurrence!=='none')throw new Error('Timed recurrence is not supported. Choose an all-day recurrence.');
 if(!task.dueAt||!task.dueTimezone||!Number.isFinite(Date.parse(task.dueAt))||localDeadline(task.dueAt,task.dueTimezone).slice(0,10)!==task.dueDate)throw new Error('Choose a valid time, date and commitment timezone.');
}
