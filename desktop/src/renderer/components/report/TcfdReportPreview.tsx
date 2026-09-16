import '@renderer/styles/report-preview.css';
import type { TcfdNarrative } from '@main/llm/tcfd-narrative';
import type { InventoryReportData } from '@main/services/report-data-service';
import { formatCo2e } from '@renderer/lib/format';
import * as m from '@renderer/paraglide/messages';
import { reportGranularityLabel, ScopeTable } from './ReportPreview';

export interface TcfdReportPreviewProps {
  data: InventoryReportData;
  narrative: TcfdNarrative;
  printMode: boolean;
  /** Pillar textareas become editable (screen only — print stays read-only). */
  editable?: boolean;
  onChange?: (narrative: TcfdNarrative) => void;
}

const PILLAR_ORDER: Array<keyof TcfdNarrative> = [
  'governance',
  'strategy',
  'risk_management',
  'metrics_targets',
];

/**
 * TCFD four-pillar report (spec 2026-07-22-tcfd-report). Shares the ISO
 * report's print stylesheet + ScopeTable; the metrics pillar is followed
 * by the quantitative appendix (scope totals, top sources, YoY / base-year
 * comparison) — every number straight from InventoryReportData, the LLM
 * narrative never carries a figure the tables don't.
 */
export function TcfdReportPreview({
  data,
  narrative,
  printMode,
  editable,
  onChange,
}: TcfdReportPreviewProps) {
  const lang = data.language;
  const locale = { locale: lang };
  const headings: Record<keyof TcfdNarrative, string> = {
    governance: m.report_preview_tcfd_governance({}, locale),
    strategy: m.report_preview_tcfd_strategy({}, locale),
    risk_management: m.report_preview_tcfd_risk({}, locale),
    metrics_targets: m.report_preview_tcfd_metrics({}, locale),
  };

  const handleEdit = (key: keyof TcfdNarrative, value: string) => {
    if (onChange) onChange({ ...narrative, [key]: value });
  };

  return (
    <div className={`report-preview ${printMode ? 'report-preview--print' : ''}`}>
      <TcfdCover data={data} />
      {PILLAR_ORDER.map((key) => (
        <section key={key} className="report-preview__section">
          <h2>{headings[key]}</h2>
          {editable && !printMode ? (
            <textarea
              defaultValue={narrative[key]}
              rows={6}
              onChange={(e) => handleEdit(key, e.target.value)}
              style={{ width: '100%' }}
            />
          ) : (
            <p>{narrative[key]}</p>
          )}
        </section>
      ))}
      <ScopeTable data={data} />
      <TopSourcesTable data={data} />
      <ComparisonTable data={data} />
    </div>
  );
}

function TcfdCover({ data }: { data: InventoryReportData }) {
  const lang = data.language;
  const orgName =
    lang !== 'en'
      ? (data.org.name_zh ?? data.org.name_en ?? '')
      : (data.org.name_en ?? data.org.name_zh ?? '');
  const title = m.report_preview_tcfd_title({}, { locale: lang });
  return (
    <section className="report-preview__cover">
      {data.org.logo_data_url && (
        <img
          src={data.org.logo_data_url}
          alt=""
          style={{ maxHeight: 56, maxWidth: 220, marginBottom: 16 }}
        />
      )}
      <h1>{title}</h1>
      <h2>{orgName}</h2>
      <p>
        {m.activities_form_period({}, { locale: lang })}: {data.period.year} (
        {reportGranularityLabel(data.period.granularity, lang)})
      </p>
    </section>
  );
}

function TopSourcesTable({ data }: { data: InventoryReportData }) {
  const lang = data.language;
  const top = data.all_sources.slice(0, 8);
  if (top.length === 0) return null;
  return (
    <section className="report-preview__scope-table">
      <h2>{m.report_preview_sources_heading({}, { locale: lang })}</h2>
      <table>
        <thead>
          <tr>
            <th>{m.activities_table_source({}, { locale: lang })}</th>
            <th>{m.report_preview_scope({}, { locale: lang })}</th>
            <th>kg CO2e</th>
            <th>{m.report_preview_share({}, { locale: lang })}</th>
          </tr>
        </thead>
        <tbody>
          {top.map((source) => (
            <tr key={source.id}>
              <td>{source.name}</td>
              <td>{source.scope}</td>
              <td>{formatCo2e(source.co2e_kg)}</td>
              <td>{source.share_pct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ComparisonTable({ data }: { data: InventoryReportData }) {
  const lang = data.language;
  const rows: Array<{ label: string; year: number; total_kg: number }> = [];
  if (data.base_year_summary) {
    rows.push({
      label: m.settings_base_year_label({}, { locale: lang }),
      ...data.base_year_summary,
    });
  }
  if (data.prior_period_summary) {
    rows.push({
      label: m.report_preview_prior_period({}, { locale: lang }),
      ...data.prior_period_summary,
    });
  }
  if (rows.length === 0) return null;
  return (
    <section className="report-preview__scope-table">
      <h2>{m.report_preview_comparison_heading({}, { locale: lang })}</h2>
      <table>
        <thead>
          <tr>
            <th>{m.report_preview_period({}, { locale: lang })}</th>
            <th>{m.report_preview_year({}, { locale: lang })}</th>
            <th>{m.report_preview_total_kg({}, { locale: lang })}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{m.report_preview_this_period({}, { locale: lang })}</td>
            <td>{data.period.year}</td>
            <td>{formatCo2e(data.scope_totals.total_kg)}</td>
          </tr>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{row.year}</td>
              <td>{formatCo2e(row.total_kg)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
