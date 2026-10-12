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
const mountWith=(preview:()=>unknown)=>{const calls:unknown[]=[];const command=vi.fn(async(_path:string,input:unknown,method?:string)=>{if(method==='GET')return {actions:[]};calls.push(input);return preview()});
 render(<MessageTaskConversion message={{id:'source',body:'Deliver report',revision:7} as never} conversation={{id:'private',version:2} as never} data={sample.workspaces[0] as WorkspaceData} command={command as never} onClose={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('Due date'),{target:{value:'2026-10-14'}});return calls;};
it('discloses the existing task title and offers linking instead of creating when the server reports an existing task',async()=>{
 const calls=mountWith(()=>({outcome:'existing',existingTaskId:'t-old',existingTaskTitle:'Already tracked survey',audienceUserIds:['u-founder'],notice:'Existing work'}));
 fireEvent.click(screen.getByRole('button',{name:'Preview audience'}));await screen.findByText('Existing work');
 expect(screen.getByText('Task title: Already tracked survey')).toBeTruthy();expect(screen.queryByText('Task title: Deliver report')).toBeNull();
 expect(screen.getByText(/No new task will be created/)).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Create task'})).toBeNull();
 const link=screen.getByRole('button',{name:'Link to existing task'}) as HTMLButtonElement;expect(link.disabled).toBe(true);
 fireEvent.click(screen.getByLabelText('I reviewed the existing task and its audience'));expect(link.disabled).toBe(false);
 fireEvent.click(link);await waitFor(()=>expect(calls).toHaveLength(2));
});
it('discloses the typed task title for a new task',async()=>{
 mountWith(()=>({outcome:'created',existingTaskId:'',existingTaskTitle:'',audienceUserIds:['u-founder'],notice:'New work'}));
 fireEvent.click(screen.getByRole('button',{name:'Preview audience'}));await screen.findByText('New work');
 expect(screen.getByText('Task title: Deliver report')).toBeTruthy();
});
it('requires a fresh confirmation for every new preview result',async()=>{
 let n=0;mountWith(()=>({outcome:'created',audienceUserIds:['u-founder'],notice:'Preview '+(++n)}));
 fireEvent.click(screen.getByRole('button',{name:'Preview audience'}));await screen.findByText('Preview 1');
 fireEvent.click(screen.getByLabelText('I reviewed the task audience and selected publication'));
 expect((screen.getByRole('button',{name:'Create task'}) as HTMLButtonElement).disabled).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Preview audience'}));await screen.findByText('Preview 2');
 expect((screen.getByLabelText('I reviewed the task audience and selected publication') as HTMLInputElement).checked).toBe(false);
 expect((screen.getByRole('button',{name:'Create task'}) as HTMLButtonElement).disabled).toBe(true);
});
