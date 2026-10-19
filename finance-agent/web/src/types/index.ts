export type BillCategory =
  | 'HOUSING'
  | 'UTILITIES'
  | 'INTERNET'
  | 'INSURANCE'
  | 'TRANSPORT'
  | 'FOOD'
  | 'HEALTH'
  | 'ENTERTAINMENT'
  | 'SUBSCRIPTION'
  | 'OTHER';

export type Recurrence = 'NONE' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export interface User {
  id: string;
  email: string;
  name: string | null;
  billReminderDays: number[];
  budgetWarningThreshold: number;
  notifyEmail: boolean;
  notifyInApp: boolean;
  createdAt: string;
}

export interface Bill {
  id: string;
  title: string;
  amount: number;
  dueDate: string; // YYYY-MM-DD
  paid: boolean;
  paidDate: string | null;
  category: BillCategory;
  provider: string;
  reference: string | null;
  documentUrl: string | null;
  /** Fichier joint (app autonome uniquement, chiffré avec les données) */
  attachment?: Attachment | null;
  notes: string | null;
  recurrence: Recurrence;
  createdAt: string;
  updatedAt: string;
}

export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  /** Nombre de morceaux enregistrés */
  chunks: number;
}

export type BillInput = Partial<Omit<Bill, 'id' | 'createdAt' | 'updatedAt' | 'category'>> & {
  title: string;
  amount: number;
  dueDate: string;
  provider: string;
  category?: BillCategory;
};

export type IncomeCategory = 'SALARY' | 'FREELANCE' | 'BENEFITS' | 'RENTAL' | 'INVESTMENT' | 'GIFT' | 'OTHER';

export interface Income {
  id: string;
  label: string;
  source: string | null;
  amount: number;
  /** Première (ou unique) rentrée */
  date: string;
  /** Dernière date incluse d'une rentrée récurrente */
  endDate: string | null;
  recurrence: Recurrence;
  category: IncomeCategory;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type IncomeInput = Omit<Income, 'id' | 'createdAt' | 'updatedAt'>;

export interface BillFilters {
  status?: 'all' | 'paid' | 'unpaid' | 'overdue';
  category?: BillCategory | '';
  from?: string;
  to?: string;
  q?: string;
  sort?: 'dueDate' | 'amount' | 'provider' | 'title' | 'createdAt';
  order?: 'asc' | 'desc';
}

export type NotificationType = 'BILL_REMINDER' | 'BUDGET_ALERT' | 'ADMIN_TASK' | 'GENERAL';

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  isRead: boolean;
  dueDate: string | null;
  billId: string | null;
  createdAt: string;
}

export interface BudgetLine {
  budgetId: string | null;
  category: BillCategory;
  spent: number;
  limit: number;
  percentageUsed: number;
}

export interface DashboardData {
  today: string;
  billsDueThisWeek: Bill[];
  billsDueThisMonth: Bill[];
  overdueBills: Bill[];
  totalAmountDue: number;
  totalOverdue: number;
  budgetSummary: BudgetLine[];
  recentTransactions: Bill[];
  upcomingReminders: AppNotification[];
  unreadNotifications: number;
  monthlyTrend: { month: string; total: number }[];
}
