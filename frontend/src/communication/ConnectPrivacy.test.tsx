// @vitest-environment happy-dom
import {describe,it,expect,vi,afterEach} from 'vitest';import {render,screen,fireEvent,cleanup} from '@testing-library/react';import Connect from './Connect';
const scope=vi.hoisted(()=>({chat:{} as any}));
vi.mock('../store',()=>({useWorkspace:()=>({companyId:'company',session:{user:{id:'member'}},mode:'api',refresh:vi.fn(),data:{me:{id:'member',role:'member'},people:[],departments:[],company:{timezone:'Asia/Kolkata'},expenseCategories:[]}})}));
vi.mock('./store',()=>({useCommunication:()=>scope.chat}));
vi.mock('./Calls',()=>({default:()=>null}));vi.mock('./ConversationSettings',()=>({default:()=>null}));vi.mock('./Structured',()=>({default:()=>null}));vi.mock('./MediaComposer',()=>({default:()=>null}));vi.mock('./WorkflowTools',()=>({default:()=>null}));
afterEach(cleanup);
describe('derived conversation privacy',()=>{it('clears open thread and saved results when access is lost',async()=>{
 const message={id:'message',conversationId:'conversation',senderId:'member',body:'private-source-marker',revision:1,mediaIds:[],createdAt:new Date().toISOString()};scope.chat={conversations:[],selected:'conversation',conversation:{id:'conversation',title:'Private',version:1,forwarding:'deny'},members:[{userId:'member',role:'member',epoch:1}],messages:[message],connected:true,command:vi.fn(async(path:string)=>path.endsWith('/thread')?{root:{...message,body:'private-thread-marker'},messages:[]}:path.endsWith('/saved')?{messages:[{...message,body:'private-saved-marker'}]}:{conversations:[]}),refreshList:vi.fn(),select:vi.fn()};
 const v=render(<Connect/>);fireEvent.click(screen.getByRole('button',{name:'Open thread'}));await screen.findByText('private-thread-marker');fireEvent.click(screen.getByRole('button',{name:'Saved and reminders'}));await screen.findByText('private-saved-marker');scope.chat={...scope.chat,conversation:null,members:[],messages:[],connected:false,error:'Access revoked'};v.rerender(<Connect/>);expect(screen.queryByText('private-thread-marker')).toBeNull();expect(screen.queryByText('private-saved-marker')).toBeNull();
 })});
