// @vitest-environment happy-dom
import React from "react";
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('@livekit/components-react',()=>({LiveKitRoom:({children}:{children:unknown})=>children,VideoConference:()=>null,RoomAudioRenderer:()=>null,ControlBar:()=>null}));
vi.mock('../data/api',()=>({request:vi.fn().mockResolvedValue({id:'device'})}));
import Calls from './Calls';
afterEach(cleanup);
it('retries a lost call acknowledgement with the same key and kind',async()=>{
 const attempts:unknown[]=[];const command=vi.fn(async(path:string,body:unknown,method?:string)=>{if(path.endsWith('/calls')&&method!=='GET'){attempts.push(body);throw new Error('Response lost')}return {calls:[]}});
 render(<Calls conversation="private" command={command as never}/>);fireEvent.click(screen.getByRole('button',{name:'Start audio call'}));await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:/Retry.*call|Start audio call/}));await waitFor(()=>expect(attempts.length).toBe(2));expect(attempts[1]).toEqual(attempts[0]);
});
