// @vitest-environment happy-dom
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import MessageTaskConversion from './MessageTaskConversion';
import sample from '../data/sample.json';import type {WorkspaceData} from '../types';
afterEach(cleanup);
it('previews and commits the same 16:00 India commitment and exact source revision',async()=>{
 const calls:unknown[]=[];const command=vi.fn(async(_path:string,input:unknown,method?:string)=>{if(method==='GET')return {actions:[]};calls.push(input);return {audienceUserIds:['u-founder'],notice:'Broader audience'}});
 render(<MessageTaskConversion message={{id:'source',body:'Deliver report',revision:7} as never} conversation={{id:'private',version:2} as never} data={sample.workspaces[0] as WorkspaceData} command={command as never} onClose={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('Deadline type'),{target:{value:'timed'}});fireEvent.change(screen.getByLabelText('Due date'),{target:{value:'2026-10-14'}});fireEvent.change(screen.getByLabelText('Due time'),{target:{value:'16:00'}});fireEvent.change(screen.getByLabelText('Commitment timezone'),{target:{value:'Asia/Kolkata'}});
 fireEvent.click(screen.getByRole('button',{name:'Preview audience'}));await screen.findByText('Broader audience');fireEvent.click(screen.getByLabelText('I reviewed the task audience and selected publication'));fireEvent.click(screen.getByRole('button',{name:'Create task'}));await waitFor(()=>expect(calls).toHaveLength(2));expect(calls[1]).toEqual(calls[0]);expect(calls[0]).toMatchObject({sources:[{messageId:'source',revision:7}],task:{deadlineMode:'timed',dueAt:'2026-10-14T10:30:00.000Z',dueTimezone:'Asia/Kolkata'}});
});
