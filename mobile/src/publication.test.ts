import {describe,it,expect} from 'vitest';
import {commitment,exactMinor} from './publication';
describe('native work publication commitments',()=>{
 it('preserves explicit time and zone rather than dropping it to a date',()=>{expect(commitment('2026-10-12','timed','2026-10-12T16:00:00+05:30','Asia/Kolkata')).toEqual({dueDate:'2026-10-12',deadlineMode:'timed',dueAt:'2026-10-12T10:30:00.000Z',dueTimezone:'Asia/Kolkata'});expect(()=>commitment('2026-10-12','timed','2026-10-12T16:00','Asia/Kolkata')).toThrow('offset');expect(commitment('2026-10-12','all_day','ignored','')).toEqual({dueDate:'2026-10-12',deadlineMode:'all_day',dueAt:'',dueTimezone:''})});
 it('rejects fractional, unsafe and non-positive minor-unit amounts',()=>{for(const value of ['1.5','0','-1','9007199254740992'])expect(()=>exactMinor(value)).toThrow();expect(exactMinor('1050')).toBe(1050)})
});
