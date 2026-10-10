"""Rebuild the fictional sample fixture. Both app adapters shift this anchor on first use."""
import json
from pathlib import Path
from datetime import date, timedelta, datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
ANCHOR = date(2026, 10, 10)
def day(n): return (ANCHOR + timedelta(days=n)).isoformat()
def stamp(n, hour=10): return f"{day(n)}T{hour:02d}:00:00Z"
C1 = dict(id="c-schach", name="Schach Engineers", slug="schach", industry="Engineering & manufacturing", timezone="Asia/Kolkata", color="#F97316", currency="INR", fiscalYearStartMonth=4, createdAt=stamp(-60))
C2 = dict(id="c-meridian", name="Meridian Works", slug="meridian", industry="Projects & services", timezone="Asia/Kolkata", color="#3B82F6", currency="INR", fiscalYearStartMonth=4, createdAt=stamp(-30))
people_specs = [
 ("u-founder","Rohan Mehta","founder@schach.demo","founder","","","Founder",40),
 ("u-ceo","Aditi Rao","ceo@schach.demo","ceo","","u-founder","Chief Executive Officer",40),
 ("u-head","Arjun Shah","head@schach.demo","head","d-eng","u-ceo","Head of Engineering",40),
 ("u-member","Meera Iyer","member@schach.demo","member","d-eng","u-head","Design Engineer",40),
 ("u-kabir","Kabir Patel","kabir@schach.demo","member","d-eng","u-head","Technical Coordinator",40),
 ("u-vikram","Vikram Desai","vikram@schach.demo","head","d-mfg","u-ceo","Head of Manufacturing",44),
 ("u-ananya","Ananya Nair","ananya@schach.demo","manager","d-mfg","u-vikram","Production Manager",44),
 ("u-rahul","Rahul Sinha","rahul@schach.demo","member","d-mfg","u-ananya","Quality Engineer",40),
 ("u-neha","Neha Kapoor","neha@schach.demo","head","d-sales","u-ceo","Head of Sales",40),
 ("u-sameer","Sameer Joshi","sameer@schach.demo","member","d-sales","u-neha","Business Development",40),
 ("u-priya","Priya Menon","priya@schach.demo","head","d-fin","u-ceo","Finance Controller",40),
 ("u-dev","Dev Kulkarni","dev@schach.demo","member","d-fin","u-priya","Accounts Executive",40),
 ("u-finance","Kavya Shah","finance@schach.demo","finance","d-fin","u-ceo","Finance Operations Lead",40),
 ("u-sana","Sana Khan","sana@schach.demo","head","d-people","u-ceo","People & Culture Lead",40),
 ("u-tara","Tara Singh","tara@schach.demo","member","d-people","u-sana","People Operations",36),
 ("u-nikhil","Nikhil Verma","nikhil@schach.demo","head","d-proc","u-ceo","Procurement Lead",40),
 ("u-isha","Isha Bhat","isha@schach.demo","member","d-proc","u-nikhil","Procurement Executive",40),
]
people = [dict(id=i,membershipId="m-"+i,name=n,email=e,role=r,departmentId=d,managerId=m,title=t,capacityHours=c,avatar="".join(x[0] for x in n.split()[:2]),active=True) for i,n,e,r,d,m,t,c in people_specs]
P = {x['id']:x for x in people}
departments = [dict(id=i,companyId=C1['id'],name=n,headId=h,color=c,description=desc) for i,n,h,c,desc in [
 ("d-eng","Engineering","u-head","#6366F1","Drawings, BOQs and technical delivery"),
 ("d-mfg","Manufacturing","u-vikram","#F97316","Production, quality and dispatch readiness"),
 ("d-sales","Sales","u-neha","#3B82F6","Customers, proposals and channel partners"),
 ("d-fin","Finance","u-priya","#16A34A","Collections, controls and financial reporting"),
 ("d-people","People & Admin","u-sana","#A855F7","People, policies and capability building"),
 ("d-proc","Procurement","u-nikhil","#14B8A6","Materials, vendor reliability and cost control"),
]]
D = {x['id']:x for x in departments}
projects = [dict(id=i,companyId=C1['id'],name=n,description=desc,departmentId=d,ownerId=o,dueDate=day(due),color=c,status="active") for i,n,desc,d,o,due,c in [
 ("p-phoenix","Phoenix Tower · Package A","Design-to-dispatch delivery of the first formwork package.","d-eng","u-head",18,"#6366F1"),
 ("p-factory","Factory performance","Improve first-pass quality and remove recurring production delays.","d-mfg","u-vikram",30,"#F97316"),
 ("p-channel","West region expansion","Build an active and measurable partner pipeline.","d-sales","u-neha",24,"#3B82F6"),
 ("p-finance","October financial close","Close the books with reconciled balances and accountable collections.","d-fin","u-priya",12,"#16A34A"),
 ("p-people","Team enablement","Give new colleagues a clear role, onboarding path and review cadence.","d-people","u-sana",20,"#A855F7"),
 ("p-supply","Supply reliability","Secure material availability and improve vendor commitments.","d-proc","u-nikhil",15,"#14B8A6"),
]]
# Each sample is deliberately fictional, with a mix of true workflow states.
specs = [
 ("Release revised podium drawings","u-member","p-phoenix","in_progress","critical",-2,70,16,"Resolve the final grid revision and issue the coordinated podium drawing set.",""),
 ("Approve supplier material test certificates","u-rahul","p-factory","in_review","high",0,100,5,"Review batch certificates against the approved procurement specification.",""),
 ("Resolve extrusion delivery delay","u-isha","p-supply","blocked","critical",-1,35,12,"Confirm a revised delivery commitment and protect the production plan.","Vendor has not confirmed the replacement vehicle. Procurement needs an escalation call."),
 ("Submit Ahmedabad partner proposal","u-sameer","p-channel","in_progress","high",1,65,10,"Prepare the commercial proposal and confirm the decision meeting.",""),
 ("Reconcile October receivables","u-dev","p-finance","in_progress","high",-3,55,12,"Reconcile receipts, identify unallocated payments and explain balance differences.",""),
 ("Complete new joiner onboarding checklist","u-tara","p-people","todo","medium",2,0,6,"Ensure access, induction and the first 30-day goals are assigned.",""),
 ("Issue tower level 8 BOQ","u-kabir","p-phoenix","in_progress","high",3,40,20,"Validate quantities against the latest coordinated drawings.",""),
 ("Review CNC maintenance plan","u-ananya","p-factory","in_progress","medium",4,30,10,"Agree the preventive maintenance window and spare-parts list.",""),
 ("Publish weekly production commitments","u-vikram","p-factory","todo","high",2,0,4,"Confirm achievable output by line and name the owner of each constraint.",""),
 ("Sign off vendor comparison for plywood","u-nikhil","p-supply","in_review","high",1,100,6,"Compare approved suppliers on landed cost, lead time and quality history.",""),
 ("Close Pune client technical queries","u-head","p-phoenix","blocked","high",-2,60,8,"Close the technical clarifications required for the final offer.","Awaiting revised structural drawings from the client."),
 ("Prepare CEO weekly finance note","u-priya","p-finance","in_review","medium",0,100,5,"Summarise cash position, overdue balances and decisions required this week.",""),
 ("Schedule quarterly performance conversations","u-sana","p-people","in_progress","medium",5,60,8,"Publish review slots and circulate the role-specific discussion guide.",""),
 ("Validate safety screen connection details","u-member","p-phoenix","todo","high",4,0,24,"Check the interface design against the approved project inputs.",""),
 ("Update partner opportunity register","u-sameer","p-channel","todo","medium",3,0,5,"Record next steps, decision dates and accountable owners for active opportunities.",""),
 ("Confirm pallet packing sequence","u-ananya","p-factory","todo","high",5,0,14,"Sequence packing to match the site's unloading and erection priorities.",""),
 ("Finish first-article dimensional inspection","u-rahul","p-factory","done","high",-4,100,8,"Record dimensional checks and close any nonconformities before release.",""),
 ("Complete drawing revision register","u-kabir","p-phoenix","done","medium",-3,100,6,"Archive superseded drawings and confirm the latest revision for each sheet.",""),
 ("Release partner onboarding kit","u-neha","p-channel","done","medium",-5,100,8,"Publish the approved product and partner onboarding material.",""),
 ("Reconcile bank transactions","u-dev","p-finance","done","medium",-4,100,6,"Match statement movements to the ledger and list unresolved items.",""),
 ("Finalise quality induction module","u-tara","p-people","done","low",-2,100,4,"Share the induction material and confirm it is understood by supervisors.",""),
 ("Approve raw material forecast","u-nikhil","p-supply","done","high",-3,100,5,"Align forecast consumption with released production requirements.",""),
 ("Review formwork panel nesting","u-member","p-phoenix","in_progress","medium",6,25,12,"Review utilisation and flag exceptions before cutting begins.",""),
 ("Collect revised freight quotation","u-isha","p-supply","todo","medium",2,0,4,"Obtain a written quotation with route, transit and handling commitments.",""),
 ("Review manufacturing rework causes","u-vikram","p-factory","blocked","high",3,45,8,"Identify the repeat defect types and corrective actions with owners.","Two inspection reports are still missing from the night shift."),
 ("Complete GIFT City account review","u-neha","p-channel","in_progress","medium",4,50,6,"Confirm stakeholder mapping and the next commercial decision.",""),
 ("Prepare department capacity review","u-sana","p-people","todo","medium",7,0,6,"Compare committed work with available hours and flag hiring needs.",""),
 ("Review monthly purchase variance","u-priya","p-finance","todo","high",6,0,10,"Explain the material purchase variance with procurement.",""),
 ("Set up site handover document pack","u-kabir","p-phoenix","backlog","medium",10,0,8,"Create the checklist for drawings, certificates and delivery documents.",""),
 ("Refresh preventative maintenance register","u-ananya","p-factory","backlog","low",12,0,6,"Update responsible technicians, frequencies and inspection evidence.",""),
 ("Publish regional customer visit plan","u-sameer","p-channel","todo","medium",5,0,8,"Schedule meetings with clear objectives and expected decisions.",""),
 ("Close outstanding expense approvals","u-dev","p-finance","in_review","medium",-1,100,4,"Resolve the supported expense claims pending department approval.",""),
 ("Complete monthly safety refresher","u-tara","p-people","in_progress","high",1,75,6,"Record attendance and action points from the safety refresher.",""),
 ("Confirm alternative extrusion supplier","u-isha","p-supply","todo","high",4,0,8,"Document specification compliance and a verified production slot.",""),
 ("Update drawing issue checklist","u-head","p-phoenix","done","medium",-6,100,4,"Make the checklist consistent across engineering handovers.",""),
 ("Complete dispatch readiness review","u-rahul","p-factory","done","high",-2,100,6,"Check identification, packing and documents against the release checklist.",""),
 ("Retire superseded vendor quotation","u-nikhil","p-supply","cancelled","low",-4,0,1,"Replaced by the updated consolidated request.",""),
 ("Review customer feedback actions","u-neha","p-channel","todo","medium",8,0,6,"Convert open feedback into a named owner and a clear acceptance criterion.",""),
 ("Daily production handover","u-ananya","p-factory","done","medium",-1,100,1,"Record output, constraints and commitments for the next shift.",""),
 ("Approve baseline package schedule","u-head","p-phoenix","done","high",-8,100,5,"Confirm the baseline milestones against the agreed delivery date.",""),
]
tasks=[]
for idx,(title,owner,project,status,priority,due,progress,effort,description,blocker) in enumerate(specs,1):
 person=P[owner]; dep=person['departmentId']; reviewer=D[dep]['headId']; reviewer="u-ceo" if reviewer==owner else reviewer
 ident=f"t-{idx:03}"; done=status in ('done','in_review'); completed=stamp(due+1 if idx in [19,20] else due-1) if status=='done' else ''
 task=dict(id=ident,code=f"SCH-{1000+idx}",companyId=C1['id'],projectId=project,departmentId=dep,parentId='',title=title,description=description,ownerId=owner,createdBy=D[dep]['headId'],reviewerId=reviewer,status=status,priority=priority,startDate=day(-5),dueDate=day(due),originalDueDate=day(due),progress=progress,estimatedHours=effort,actualHours=round(effort*progress/100,1),tags=["Delivery" if project=="p-phoenix" else "Operations"],checklist=[dict(id=ident+'-a',text="Validate required inputs",done=done or progress>30),dict(id=ident+'-b',text="Attach evidence and confirm acceptance",done=done)],dependencies=[],collaborators=[],recurrence='daily' if idx==39 else 'none',requiresApproval=True,blockerReason=blocker,deadlineChangeReason='',completedAt=completed,createdAt=stamp(-9),updatedAt=stamp(-1 if progress else -4),version=1,comments=[],timeEntries=[],attachments=[])
 if idx in [1,3,5,11,25]: task['comments']=[dict(id=ident+'-comment',userId=reviewer,body="Please add the next action and the support you need. Keep the commitment date current with a reason for any change.",createdAt=stamp(-1,13))]
 if idx==1: task['dependencies']=['t-040']; task['originalDueDate']=day(-4); task['deadlineChangeReason']='Revised podium grid received after the baseline was agreed.'
 if idx==14: task['dependencies']=['t-001']
 if task['actualHours']>0:
  remaining=task['actualHours']; entry=0
  while remaining>0:
   hours=min(remaining,8); task['timeEntries'].append(dict(id=ident+'-time-'+str(entry),userId=owner,hours=hours,date=day(-1-entry),note="Progress against the agreed deliverable",createdAt=stamp(-1-entry,12))); remaining=round(remaining-hours,2);entry+=1
 tasks.append(task)
goals=[
 dict(id='g-delivery',companyId=C1['id'],name='Improve drawing delivery reliability',description='Accepted drawing packages completed within the original commitment.',ownerId='u-head',departmentId='d-eng',unit='%',baseline=70,target=95,current=84,dueDate=day(30),taskIds=['t-001','t-007','t-014','t-018']),
 dict(id='g-quality',companyId=C1['id'],name='Reduce manufacturing rework',description='Track the proportion of inspected output requiring rework.',ownerId='u-vikram',departmentId='d-mfg',unit='%',baseline=8,target=3,current=4.8,dueDate=day(30),taskIds=['t-017','t-025','t-036']),
 dict(id='g-partners',companyId=C1['id'],name='Activate qualified channel partners',description='Count partners with completed onboarding and a qualified opportunity.',ownerId='u-neha',departmentId='d-sales',unit='partners',baseline=0,target=12,current=7,dueDate=day(24),taskIds=['t-004','t-019','t-026']),
 dict(id='g-collection',companyId=C1['id'],name='Close reconciliation exceptions',description='Resolve outstanding reconciliation items with documented evidence.',ownerId='u-priya',departmentId='d-fin',unit='items',baseline=0,target=30,current=23,dueDate=day(12),taskIds=['t-005','t-012','t-020']),
]
activities=[dict(id='a-'+str(i),companyId=C1['id'],taskId=t['id'],userId=t['ownerId'],action='submitted_for_review' if t['status']=='in_review' else 'progress_updated',detail=f"{t['code']} · {t['title']}",createdAt=stamp(0,10-i%4)) for i,t in enumerate(tasks[:8])]
activities.insert(0,dict(id='a-baseline',companyId=C1['id'],taskId='t-001',userId='u-head',action='deadline_changed',detail=f"Deadline changed from {day(-4)} to {day(-2)}. Revised podium grid received after the baseline was agreed.",createdAt=stamp(-2)))
notifications=[dict(id='n-'+str(i),companyId=C1['id'],userId='u-founder',taskId=t['id'],title=title,body=t['title'],kind=kind,read=False,createdAt=stamp(0,9+i)) for i,(t,title,kind) in enumerate([(tasks[2],'A critical commitment is blocked','blocked'),(tasks[0],'Engineering needs a deadline decision','overdue'),(tasks[11],'Finance note ready for review','review')])]
W1=dict(company=C1,me=P['u-founder'],departments=departments,people=people,projects=projects,tasks=tasks,goals=goals,activities=activities,notifications=notifications)
mp=[dict(P['u-founder'],membershipId='meridian-founder'),dict(id='u-meridian',membershipId='meridian-head',name='Avni Desai',email='avni@meridian.demo',role='head',departmentId='d-projects',managerId='u-founder',title='Head of Projects',capacityHours=40,avatar='AD',active=True)]
mt=[]
for i in range(4):
 t=dict(tasks[5+i]);t.update(id='mt-'+str(i),code='MER-'+str(1001+i),companyId=C2['id'],title=['Confirm mobilisation checklist','Review site delivery schedule','Approve project risk register','Issue stakeholder weekly update'][i],departmentId='d-projects',projectId='p-meridian',ownerId='u-meridian',reviewerId='u-founder',createdBy='u-founder',status=['in_progress','todo','in_review','done'][i],progress=[60,0,100,100][i],actualHours=0,dueDate=day(i+1),originalDueDate=day(i+1),comments=[],timeEntries=[],attachments=[],checklist=[],dependencies=[],collaborators=[],completedAt=stamp(-1) if i==3 else '',recurrence='none');mt.append(t)
W2=dict(company=C2,me=mp[0],departments=[dict(id='d-projects',companyId=C2['id'],name='Projects',headId='u-meridian',color='#3B82F6',description='Project delivery and customer coordination')],people=mp,projects=[dict(id='p-meridian',companyId=C2['id'],name='Project Northstar',description='A separate fictional environment to demonstrate company isolation.',departmentId='d-projects',ownerId='u-meridian',dueDate=day(20),color='#3B82F6',status='active')],tasks=mt,goals=[],activities=[],notifications=[])
# Financial sample records are fictional. Budgets retain exact fiscal-year boundaries
# when either adapter moves this anchor to the current date.
receipt_contents = {}
category_specs = [("Materials", "#F97316"), ("Equipment", "#6366F1"), ("Travel", "#3B82F6"), ("Software", "#14B8A6"), ("Professional services", "#A855F7"), ("People & administration", "#16A34A"), ("Other", "#64748B")]
def add_finance(workspace, allocations, expense_specs):
 company = workspace['company']; cid = company['id']
 workspace.update(financeScope='company', expenseCategories=[dict(id=f'{cid}-category-{i}',companyId=cid,name=name,color=color,active=True,receiptRequired=True,version=1) for i,(name,color) in enumerate(category_specs,1)], budgets=[], expenses=[], financeEvents=[])
 def event(entity_type, entity_id, department, user, action, detail, offset):
  workspace['financeEvents'].append(dict(id=f'{cid}-fe-{len(workspace["financeEvents"])+1}',companyId=cid,departmentId=department,entityType=entity_type,entityId=entity_id,userId=user,action=action,detail=detail,createdAt=stamp(offset)))
 for dept in workspace['departments']:
  for year,status in [(2025,'closed'),(2026,'active')]:
   amount=allocations[dept['id']]
   b=dict(id=f'{cid}-budget-{dept["id"]}-{year}',companyId=cid,departmentId=dept['id'],name=f'{dept["name"]} · FY {year}–{str(year+1)[2:]}',startDate=f'{year}-04-01',endDate=f'{year+1}-03-31',amountMinor=amount,currency=company['currency'],status=status,notes='Fictional operating allocation for the interactive sample.',createdBy='u-founder',createdAt=f'{year}-03-20T10:00:00Z',updatedAt=stamp(-25),version=2)
   workspace['budgets'].append(b)
   event('budget',b['id'],dept['id'],'u-founder','budget_created',f'{b["name"]}: {amount} minor units allocated.',-25)
 for i,(creator,category,title,vendor,amount,status,offset,task_id,exception) in enumerate(expense_specs,1):
  person=next(p for p in workspace['people'] if p['id']==creator)
  department=person['departmentId']; linked=next((t for t in workspace['tasks'] if t['id']==task_id),None)
  e=dict(id=f'{cid}-expense-{i}',companyId=cid,code=f'EXP-{i:04}',departmentId=department,categoryId=f'{cid}-category-{category}',title=title,description='Fictional sample expense for reviewing department spending and approvals.',vendor=vendor,invoiceNumber=f'DEMO-{cid[-3:].upper()}-{i:03}',expenseDate=day(offset),amountMinor=amount,currency=company['currency'],projectId=linked['projectId'] if linked else '',taskId=task_id,createdBy=creator,status=status,receiptExceptionReason=exception,submittedAt=stamp(offset,11) if status not in ('draft','void') else '',reviewedBy='',reviewedAt='',reviewNote='',budgetOverrideReason='',paidBy='',paidAt='',paidDate='',paymentMethod='',paymentReference='',createdAt=stamp(offset),updatedAt=stamp(offset),version=1,receipts=[])
  if not exception and status!='draft':
   rid=f'{e["id"]}-receipt'
   content=f'FICTIONAL SAMPLE RECEIPT — NOT A TAX INVOICE\nCompany: {company["name"]}\nVendor: {vendor}\nReference: {e["invoiceNumber"]}\nDescription: {title}\nGross amount: {amount//100}.{amount%100:02} {company["currency"]}\nFor demonstration only. No payment or tax claim is implied.\n'
   receipt_contents[rid]=content
   e['receipts'].append(dict(id=rid,fileName=f'{e["code"]}-sample-receipt.txt',mimeType='text/plain; charset=utf-8',size=len(content.encode('utf-8')),uploadedBy=creator,createdAt=stamp(offset)))
  if status in ('approved','paid','rejected'):
   reviewer=next(d['headId'] for d in workspace['departments'] if d['id']==department)
   if reviewer==creator: reviewer='u-founder'
   e.update(reviewedBy=reviewer,reviewedAt=stamp(offset,12),reviewNote='Receipt and business purpose reviewed.' if status!='rejected' else 'Please correct the invoice reference and explain the business purpose.',version=3)
  if status=='paid':
   payer='u-finance' if cid==C1['id'] and creator!='u-finance' else 'u-founder'
   e.update(paidBy=payer,paidAt=stamp(offset+1),paidDate=day(offset+1),paymentMethod='bank_transfer',paymentReference=f'DEMO-TRANSFER-{i:04}',version=4)
  if status=='submitted': e['version']=2
  workspace['expenses'].append(e)
  event('expense',e['id'],department,creator,'expense_created',f'{e["code"]} · {title}',offset)
  if e['submittedAt']: event('expense',e['id'],department,creator,'expense_submitted','Submitted for independent review.',offset)
  if e['reviewedBy']: event('expense',e['id'],department,e['reviewedBy'],'expense_'+('rejected' if status=='rejected' else 'approved'),e['reviewNote'],offset)
  if status=='paid': event('expense',e['id'],department,e['paidBy'],'payment_recorded',f'External payment recorded: {e["paymentReference"]}.',offset+1)
  if status=='submitted':
   recipients=['u-founder']+(['u-finance'] if cid==C1['id'] else [])+[next(d['headId'] for d in workspace['departments'] if d['id']==department)]
   for recipient in set(recipients)-{creator}:
    workspace['notifications'].append(dict(id=f'{e["id"]}-notice-{recipient}',companyId=cid,userId=recipient,taskId='',expenseId=e['id'],title='Expense ready for review',body=f'{e["code"]} · {title}',kind='expense_review',read=False,createdAt=stamp(offset,11)))
add_finance(W1, {'d-eng':120000000,'d-mfg':250000000,'d-sales':60000000,'d-fin':30000000,'d-people':45000000,'d-proc':180000000}, [
 ('u-member',4,'Design software annual renewal','Sample Design Systems',18500000,'paid',-18,'t-001',''),
 ('u-kabir',2,'Survey equipment calibration','Sample Precision Labs',4250000,'approved',-6,'t-007',''),
 ('u-member',3,'Phoenix site coordination visit','Sample Travel Desk',1875000,'submitted',-2,'t-014',''),
 ('u-head',5,'Independent design peer review','Sample Structural Advisors',9500000,'submitted',-3,'t-011',''),
 ('u-ananya',2,'CNC preventive maintenance service','Sample Machine Care',16500000,'paid',-14,'t-008',''),
 ('u-rahul',1,'Inspection gauges and test coupons','Sample Quality Supplies',3825000,'approved',-4,'t-017',''),
 ('u-vikram',6,'Factory safety refresher material','Sample Safety Academy',1250000,'submitted',-1,'t-009',''),
 ('u-sameer',3,'Ahmedabad customer visit','Sample Regional Travel',2845000,'paid',-8,'t-004',''),
 ('u-neha',5,'Partner launch venue deposit','Sample Events Studio',6750000,'approved',-5,'t-026',''),
 ('u-sameer',3,'Local customer meeting transport','Sample City Mobility',42000,'submitted',-1,'t-015','Original receipt was misplaced during the site visit; trip details are recorded.'),
 ('u-dev',4,'Accounts reporting subscription','Sample Ledger Software',3600000,'paid',-22,'t-005',''),
 ('u-finance',5,'Controls workshop facilitation','Sample Controls Advisory',2500000,'draft',-1,'',''),
 ('u-tara',6,'New joiner induction materials','Sample Team Supplies',1850000,'approved',-3,'t-006',''),
 ('u-sana',6,'Leadership training programme','Sample Learning Partners',8250000,'submitted',-2,'t-013',''),
 ('u-isha',1,'Approved plywood sample batch','Sample Panel Industries',14250000,'paid',-12,'t-003',''),
 ('u-isha',3,'Supplier inspection travel','Sample Vendor Travel',960000,'rejected',-4,'t-024',''),
 ('u-nikhil',7,'Cancelled freight reservation','Sample Freight Services',480000,'void',-5,'t-010',''),
])
add_finance(W2, {'d-projects':80000000}, [
 ('u-meridian',3,'Northstar site mobilisation visit','Sample Northstar Travel',1250000,'paid',-7,'mt-0',''),
 ('u-meridian',5,'Site logistics planning support','Sample Site Advisory',4500000,'submitted',-2,'mt-1',''),
])

sessions=[dict(user=dict(id=p['id'],name=p['name'],email=p['email'],isPlatformAdmin=p['id']=='u-founder'),companies=[C1,C2] if p['id']=='u-founder' else [C1]) for p in people]
sessions.append(dict(user=dict(id='u-meridian',name='Avni Desai',email='avni@meridian.demo',isPlatformAdmin=False),companies=[C2]))
out=ROOT/'frontend/src/data/sample.json';out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(dict(anchorDate=ANCHOR.isoformat(),sessions=sessions,workspaces=[W1,W2],receiptContents=receipt_contents),indent=2)+'\n')
print(f'Created {out} with {len(tasks)+len(mt)} tasks and two fictional companies.')
