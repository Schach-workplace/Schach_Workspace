import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {NativeClient} from './client';
const storage=vi.hoisted(()=>new Map<string,string>());
vi.mock('expo-secure-store',()=>({getItemAsync:vi.fn(async(k:string)=>storage.get(k)??null),setItemAsync:vi.fn(async(k:string,v:string)=>{storage.set(k,v)}),deleteItemAsync:vi.fn(async(k:string)=>{storage.delete(k)})}));
beforeEach(()=>{storage.clear();vi.stubGlobal('__DEV__',false)});afterEach(()=>vi.unstubAllGlobals());
describe('native authorization boundary',()=>{
 it('keeps bearer credentials out of URLs and requires HTTPS in release',async()=>{const c=new NativeClient();await expect(c.login('http://workspace.example.in','a','b')).rejects.toThrow('secure');await expect(c.login('https://user:secret@workspace.example.in','a','b')).rejects.toThrow('without credentials');const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({})});vi.stubGlobal('fetch',fetch);c.endpoint='https://workspace.example.in';c.token='secret-bearer';await c.request('/companies/one/conversations');expect(fetch.mock.calls[0][0]).not.toContain('secret');expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer secret-bearer')});
 it('rejects a response whose body finished after a company switch',async()=>{let resolve:(v:unknown)=>void=()=>{};const c=new NativeClient();c.endpoint='https://workspace.example.in';vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:()=>new Promise(r=>{resolve=r})}));const pending=c.request('/companies/old/conversations');await Promise.resolve();c.clearGeneration();resolve({private:'old company'});await expect(pending).rejects.toThrow('changed')});
 it('clears the secure token after logout even when the network fails',async()=>{const c=new NativeClient();c.endpoint='https://workspace.example.in';c.token='session';storage.set('schach.session','session');vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));await expect(c.logout()).rejects.toThrow('offline');expect(c.token).toBe('');expect(storage.has('schach.session')).toBe(false)});
 it('refuses a development HTTP endpoint restored into a release client',async()=>{storage.set('schach.endpoint','http://localhost:8080');storage.set('schach.session','session');const c=new NativeClient();await c.restore();expect(c.token).toBe('');expect(storage.has('schach.session')).toBe(false)});
});

describe('native policy contact',()=>{
 it('invalidates registered private UI and in-flight generations after an authorization denial',async()=>{
 const c=new NativeClient();c.endpoint='https://workspace.example.in';c.token='session';const clear=vi.fn();c.onPolicyChange=clear;
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:404,json:async()=>({error:{message:'Current conversation unavailable'}})}));const generation=c.generation;
 await expect(c.request('/companies/one/conversations/private')).rejects.toThrow('unavailable');expect(clear).toHaveBeenCalledOnce();expect(c.generation).toBeGreaterThan(generation)
 });
});
