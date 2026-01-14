/**
 * Migration utility for AbsolutelyRight
 * Handles localStorage key migration from old naming to new naming
 */

const MIGRATIONS: Array<{ oldKey: string; newKey: string }> = [
  { oldKey: 'claude-kanban-cards', newKey: 'absolutely-right-cards' },
  { oldKey: 'claude-kanban-projects', newKey: 'absolutely-right-projects' },
];

/**
 * Run migrations on app startup
 * Migrates old localStorage keys to new ones, preserving data
 */
export function runMigrations(): void {
  for (const { oldKey, newKey } of MIGRATIONS) {
    const oldData = localStorage.getItem(oldKey);
    const newData = localStorage.getItem(newKey);

    // If old data exists and new data doesn't, migrate
    if (oldData && !newData) {
      console.log(`[Migration] Migrating ${oldKey} to ${newKey}`);
      localStorage.setItem(newKey, oldData);
      localStorage.removeItem(oldKey);
    }
    // If both exist, prefer new data and clean up old
    else if (oldData && newData) {
      console.log(`[Migration] Cleaning up old key ${oldKey}`);
      localStorage.removeItem(oldKey);
    }
  }
}
