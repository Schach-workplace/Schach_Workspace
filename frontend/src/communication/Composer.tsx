import {useState} from 'react';
import type {Message,Member} from './types';
interface Send {clientMessageId:string;body:string;replyToId:string;mentionIds?:string[];mentionAll?:boolean}
export default function Composer({send,disabled,reply,onClearReply,members=[],names={},canMentionAll=false}:{members?:Member[];names?:Record<string,string>;canMentionAll?:boolean;send:(input:Send)=>Promise<{message:Message}>;disabled:boolean;reply:Message|null;onClearReply:()=>void}){
 const[mentions,setMentions]=useState<string[]>([]);const[all,setAll]=useState(false);const[draft,setDraft]=useState('');const[pending,setPending]=useState<Send|null>(null);const[busy,setBusy]=useState(false);const[error,setError]=useState('');
 async function submit(input:Send){setPending(input);setBusy(true);setError('');try{await send(input);setPending(null);setDraft(old=>old===input.body?'':old);onClearReply();setMentions([]);setAll(false)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <form onSubmit={e=>{e.preventDefault();if(!draft.trim()||busy||disabled)return;void submit(pending??{clientMessageId:crypto.randomUUID(),body:draft,replyToId:reply?.id??'',mentionIds:mentions,mentionAll:all})}}>
 {reply&&<div>Reply to {reply.body.slice(0,80)} <button type="button" onClick={onClearReply}>Cancel reply</button></div>}
 <label htmlFor="connect-compose">Message</label><textarea id="connect-compose" maxLength={20000} disabled={disabled||busy||!!pending} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Write a message…" />
 <details><summary>Mention participants</summary>{members.map(m=><label key={m.userId}><input type="checkbox" disabled={disabled||busy||!!pending} checked={mentions.includes(m.userId)} onChange={e=>setMentions(ids=>e.target.checked?[...ids,m.userId]:ids.filter(id=>id!==m.userId))}/>{names[m.userId]??'Company member'}</label>)}{canMentionAll&&<label><input type="checkbox" disabled={disabled||busy||!!pending} checked={all} onChange={e=>setAll(e.target.checked)}/>Mention everyone (limited to once per five minutes)</label>}</details>
 {error&&<p role="alert">{error} Your message is waiting for a confirmed response.</p>}
 <button className="button button-primary" disabled={disabled||busy||!draft.trim()}>{busy?'Sending…':pending?'Retry same message':'Send'}</button>
 {pending&&!busy&&<button type="button" onClick={()=>{setPending(null);setError('')}}>Return to draft</button>}
 </form>
}
