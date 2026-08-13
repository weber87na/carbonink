import { invoke } from '../ipc.js';

export const reportApi = {
  generate: (input: { report_id: string; reporting_period_id: string; language: 'zh-CN' | 'en' }) =>
    invoke('report:generate', input),
  cancel: (input: { report_id: string }) => invoke('report:cancel', input),
  exportPdf: (input: { data: unknown; narrative: unknown; language: 'zh-CN' | 'en' }) =>
    invoke('report:export-pdf', input as never),
  exportXlsx: (input: { data: unknown; narrative: unknown; language: 'zh-CN' | 'en' }) =>
    invoke('report:export-xlsx', input as never),
  // TCFD four-pillar report (spec 2026-07-22-tcfd-report). Cancel is shared.
  generateTcfd: (input: {
    report_id: string;
    reporting_period_id: string;
    language: 'zh-CN' | 'en';
  }) => invoke('report:generate-tcfd', input),
  exportTcfdPdf: (input: { data: unknown; narrative: unknown; language: 'zh-CN' | 'en' }) =>
    invoke('report:export-tcfd-pdf', input as never),
  exportTcfdXlsx: (input: { data: unknown; narrative: unknown; language: 'zh-CN' | 'en' }) =>
    invoke('report:export-tcfd-xlsx', input as never),
  // Client deliverable bundle (spec 2026-07-23-client-deliverable-bundle).
  exportDeliverable: (input: {
    data: unknown;
    narrative: unknown;
    language: 'zh-CN' | 'en';
    kind: 'iso' | 'tcfd';
    // Rendered readiness sweep -- copy is built renderer-side, see
    // components/readiness/copy.ts.
    readiness?: {
      checked_at: string;
      counts: { blocker: number; warning: number; info: number };
      check_count: number;
      rows: ReadonlyArray<{
        severity: string;
        check_id: string;
        title: string;
        detail: string;
        entity_type: string;
        entity_id: string;
      }>;
    };
  }) => invoke('report:export-deliverable', input as never),
};
