/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CATEGORIES } from './parser';

export interface Budget {
  id: string; // Matches CATEGORY id or custom id
  name: string;
  limit: number;
  spent: number;
  icon: string;
  color: string;
}

export interface Expense {
  id: string;
  amount: number;
  categoryId: string;
  date: string; // YYYY-MM-DD
  note: string;
}

export interface SavingGoal {
  id: string;
  name: string;
  targetAmount: number;
  currentProgress: number;
  color: string;
}

// Default initial data for a beautiful and engaging first-time user experience
export const DEFAULT_BUDGETS: Budget[] = [
  {
    id: 'groceries',
    name: 'Groceries',
    limit: 400,
    spent: 0,
    icon: 'ShoppingCart',
    color: 'emerald'
  },
  {
    id: 'dining',
    name: 'Dining Out',
    limit: 250,
    spent: 0,
    icon: 'Utensils',
    color: 'amber'
  },
  {
    id: 'transport',
    name: 'Transport',
    limit: 120,
    spent: 0,
    icon: 'Car',
    color: 'blue'
  },
  {
    id: 'entertainment',
    name: 'Entertainment',
    limit: 100,
    spent: 0,
    icon: 'Film',
    color: 'purple'
  },
  {
    id: 'utilities',
    name: 'Utilities',
    limit: 300,
    spent: 0,
    icon: 'Zap',
    color: 'orange'
  },
  {
    id: 'shopping',
    name: 'Shopping',
    limit: 200,
    spent: 0,
    icon: 'ShoppingBag',
    color: 'pink'
  }
];

export const DEFAULT_EXPENSES: Expense[] = [];

export const DEFAULT_GOALS: SavingGoal[] = [];

// Helper functions for Local Storage persistence
export const storage = {
  getBudgets: (): Budget[] => {
    try {
      const stored = localStorage.getItem('floe_budgets');
      return stored ? JSON.parse(stored) : DEFAULT_BUDGETS;
    } catch {
      return DEFAULT_BUDGETS;
    }
  },
  setBudgets: (budgets: Budget[]): void => {
    localStorage.setItem('floe_budgets', JSON.stringify(budgets));
  },

  getExpenses: (): Expense[] => {
    try {
      const stored = localStorage.getItem('floe_expenses');
      return stored ? JSON.parse(stored) : DEFAULT_EXPENSES;
    } catch {
      return DEFAULT_EXPENSES;
    }
  },
  setExpenses: (expenses: Expense[]): void => {
    localStorage.setItem('floe_expenses', JSON.stringify(expenses));
  },

  getGoals: (): SavingGoal[] => {
    try {
      const stored = localStorage.getItem('floe_goals');
      return stored ? JSON.parse(stored) : DEFAULT_GOALS;
    } catch {
      return DEFAULT_GOALS;
    }
  },
  setGoals: (goals: SavingGoal[]): void => {
    localStorage.setItem('floe_goals', JSON.stringify(goals));
  }
};
