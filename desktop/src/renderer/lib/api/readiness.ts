import { invoke } from '../ipc';

export const readinessApi = {
  run: (reporting_period_id: string) => invoke('readiness:run', { reporting_period_id }),
  dismiss: (key: string) => invoke('readiness:dismiss', { key }),
  undismiss: (key: string) => invoke('readiness:undismiss', { key }),
};
