import { request } from '../data/api';
export function communicationRequest<T>(company:string,path:string,options:Parameters<typeof request>[1]={}){return request<T>(`/companies/${encodeURIComponent(company)}${path}`,options)}
export function streamURL(company:string,conversation:string){const base=new URL(import.meta.env.VITE_API_URL||window.location.origin);base.protocol=base.protocol==='https:'?'wss:':'ws:';base.pathname=`/api/companies/${encodeURIComponent(company)}/conversations/${encodeURIComponent(conversation)}/stream`;base.search='';return base.href}
