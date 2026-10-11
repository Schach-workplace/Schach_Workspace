export type Role =
  'founder' | 'ceo' | 'admin' | 'finance' | 'head' | 'manager' | 'member' | 'viewer';
export type TaskStatus =
  'backlog' | 'todo' | 'in_progress' | 'blocked' | 'in_review' | 'done' | 'cancelled';
export type Priority = 'critical' | 'high' | 'medium' | 'low';
export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly';
export type View =
  | 'connect'
  | 'overview'
  | 'my-work'
  | 'tasks'
  | 'projects'
  | 'calendar'
  | 'workload'
  | 'goals'
  | 'reports'
  | 'finance'
  | 'people'
  | 'inbox'
  | 'settings';
export interface Company {
  companyPermissionEpoch: number;
  id: string;
  name: string;
  slug: string;
  industry: string;
  timezone: string;
  color: string;
  createdAt: string;
  currency: string;
  fiscalYearStartMonth: number;
}
export interface User {
  id: string;
  name: string;
  email: string;
  isPlatformAdmin: boolean;
}
export interface Person {
  membershipVersion: number;
  memberAccessEpoch: number;
  companyPermissionEpoch: number;
  id: string;
  membershipId: string;
  name: string;
  email: string;
  role: Role;
  departmentId: string;
  managerId: string;
  title: string;
  capacityHours: number;
  avatar: string;
  active: boolean;
}
export interface Department {
  version: number;
  id: string;
  companyId: string;
  name: string;
  headId: string;
  color: string;
  description: string;
}
export interface Project {
  version?: number;
  taskOwnerPolicy?: 'actor' | 'project_owner' | 'fixed';
  defaultTaskOwnerId?: string;
  defaultReviewerId?: string;
  defaultRequiresApproval?: boolean;
  id: string;
  companyId: string;
  name: string;
  description: string;
  departmentId: string;
  ownerId: string;
  dueDate: string;
  color: string;
  status: 'active' | 'on_hold' | 'completed' | 'archived';
}
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}
export interface Comment {
  id: string;
  userId: string;
  body: string;
  createdAt: string;
}
export interface TimeEntry {
  id: string;
  userId: string;
  hours: number;
  date: string;
  note: string;
  createdAt: string;
}
export interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  createdAt: string;
}
export interface Task {
  id: string;
  code: string;
  companyId: string;
  projectId: string;
  departmentId: string;
  parentId: string;
  title: string;
  description: string;
  ownerId: string;
  createdBy: string;
  reviewerId: string;
  status: TaskStatus;
  priority: Priority;
  startDate: string;
  dueDate: string;
  deadlineMode?: 'all_day' | 'timed';
  dueAt?: string;
  dueTimezone?: string;
  originalDeadlineMode?: 'all_day' | 'timed';
  originalDueAt?: string;
  originalDueTimezone?: string;
  originalDueDate: string;
  progress: number;
  estimatedHours: number;
  actualHours: number;
  tags: string[];
  checklist: ChecklistItem[];
  dependencies: string[];
  collaborators: string[];
  recurrence: Recurrence;
  requiresApproval: boolean;
  blockerReason: string;
  deadlineChangeReason: string;
  completedAt: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  comments: Comment[];
  timeEntries: TimeEntry[];
  attachments: Attachment[];
}
export interface Goal {
  id: string;
  companyId: string;
  name: string;
  description: string;
  ownerId: string;
  departmentId: string;
  unit: string;
  baseline: number;
  target: number;
  current: number;
  dueDate: string;
  taskIds: string[];
}
export interface Activity {
  id: string;
  companyId: string;
  taskId: string;
  userId: string;
  action: string;
  detail: string;
  createdAt: string;
}
export interface Notification {
  id: string;
  companyId: string;
  userId: string;
  taskId: string;
  expenseId?: string;
  title: string;
  body: string;
  kind: string;
  read: boolean;
  createdAt: string;
}
export interface Session {
  user: User;
  companies: Company[];
}
export interface WorkspaceData {
  readBasis?: string;
  company: Company;
  me: Person;
  departments: Department[];
  people: Person[];
  projects: Project[];
  tasks: Task[];
  goals: Goal[];
  activities: Activity[];
  notifications: Notification[];
  financeScope: FinanceScope;
  expenseCategories: ExpenseCategory[];
  budgets: Budget[];
  expenses: Expense[];
  financeEvents: FinanceEvent[];
}
export type FinanceScope = 'company' | 'department' | 'personal' | 'none';
export type BudgetStatus = 'draft' | 'active' | 'closed';
export type ExpenseStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid' | 'void';
export type PaymentMethod = 'bank_transfer' | 'upi' | 'card' | 'cash' | 'other';
export interface ExpenseCategory {
  id: string;
  companyId: string;
  name: string;
  color: string;
  active: boolean;
  receiptRequired: boolean;
  version: number;
}
export interface Budget {
  id: string;
  companyId: string;
  departmentId: string;
  name: string;
  startDate: string;
  endDate: string;
  amountMinor: number;
  currency: string;
  status: BudgetStatus;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}
export interface Expense {
  id: string;
  companyId: string;
  code: string;
  departmentId: string;
  categoryId: string;
  title: string;
  description: string;
  vendor: string;
  invoiceNumber: string;
  expenseDate: string;
  amountMinor: number;
  currency: string;
  projectId: string;
  taskId: string;
  createdBy: string;
  status: ExpenseStatus;
  receiptExceptionReason: string;
  submittedAt: string;
  reviewedBy: string;
  reviewedAt: string;
  reviewNote: string;
  budgetOverrideReason: string;
  paidBy: string;
  paidAt: string;
  paidDate: string;
  paymentMethod: PaymentMethod | '';
  paymentReference: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  receipts: Attachment[];
}
export interface FinanceEvent {
  id: string;
  companyId: string;
  departmentId: string;
  entityType: 'budget' | 'expense' | 'category' | 'settings';
  entityId: string;
  userId: string;
  action: string;
  detail: string;
  createdAt: string;
}
export interface CreateTaskInput {
  title: string;
  description: string;
  ownerId: string;
  reviewerId: string;
  departmentId: string;
  projectId: string;
  parentId: string;
  priority: Priority;
  status: TaskStatus;
  dueDate: string;
  deadlineMode?: 'all_day' | 'timed';
  dueAt?: string;
  dueTimezone?: string;

  startDate: string;
  estimatedHours: number;
  tags: string[];
  checklist: ChecklistItem[];
  dependencies: string[];
  collaborators: string[];
  recurrence: Recurrence;
  requiresApproval: boolean;
}
export type TaskPatch = Partial<CreateTaskInput> & {
  version: number;
  progress?: number;
  blockerReason?: string;
  deadlineChangeReason?: string;
};
export interface TaskFilters {
  search: string;
  departmentId: string;
  ownerId: string;
  projectId: string;
  status: string;
  priority: string;
  due: string;
}
export interface MutationResult {
  ids?: string[];
  ok: boolean;
  id?: string;
  created?: number;
  reminders?: number;
}
export interface WorkspaceStore {
  authorizing?: boolean;
  mode: 'demo' | 'api';
  session: Session | null;
  data: WorkspaceData | null;
  companyId: string;
  loading: boolean;
  saving: boolean;
  error: string;
  toast: string;
  login: (email: string, password: string, code?: string, recoveryCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  switchCompany: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  mutate: (
    path: string,
    body?: unknown,
    method?: 'POST' | 'PATCH',
    onCommitted?: (result: MutationResult) => void,
  ) => Promise<MutationResult>;
  upload: (taskId: string, file: File) => Promise<void>;
  downloadAttachment: (attachment: Attachment) => Promise<void>;
  uploadExpenseReceipt: (expenseId: string, file: File) => Promise<void>;
  downloadExpenseReceipt: (attachment: Attachment) => Promise<void>;
  notify: (message: string) => void;
  clearError: () => void;
  resetDemo: () => Promise<void>;
}

export type {
  AttentionView,
  AttentionTransitionInput,
  AttentionPreference,
} from '../../shared/attention/types';
