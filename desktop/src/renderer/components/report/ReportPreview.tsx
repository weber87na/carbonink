import '@renderer/styles/report-preview.css';
import type { ReportNarrative } from '@main/llm/report-narrative';
import type { InventoryReportData } from '@main/services/report-data-service';
import { formatCo2e } from '@renderer/lib/format';
import * as m from '@renderer/paraglide/messages';

export interface ReportPreviewProps {
  data: InventoryReportData;
  narrative: ReportNarrative;
  printMode: boolean;
  editable?: boolean;
  onChange?: (narrative: ReportNarrative) => void;
}

const SECTION_ORDER: Array<keyof ReportNarrative> = [
  'boundary_description',
  'reporting_boundary_description',
  'methodology_description',
  'emissions_summary',
  'significant_changes',
  'notable_observations',
];

export function ReportPreview({
  data,
  narrative,
  printMode,
  editable,
  onChange,
}: ReportPreviewProps) {
  const lang = data.language;
  const locale = { locale: lang };
  const headings: Record<keyof ReportNarrative, string> = {
    boundary_description: `5.1 ${m.reports_narrative_field_boundary({}, locale)}`,
    reporting_boundary_description: `5.2 ${m.reports_narrative_field_reporting_boundary({}, locale)}`,
    methodology_description: `7.1 ${m.reports_narrative_field_methodology({}, locale)}`,
    emissions_summary: `8 ${m.reports_narrative_field_emissions({}, locale)}`,
    significant_changes: `9.3.11 ${m.reports_narrative_field_changes({}, locale)}`,
    notable_observations: m.report_preview_observations_heading({}, locale),
  };

  const handleNarrativeEdit = (key: keyof ReportNarrative, value: string) => {
    if (onChange) {
      onChange({ ...narrative, [key]: value });
    }
  };

  return (
    <div className={`report-preview ${printMode ? 'report-preview--print' : ''}`}>
      <CoverPage data={data} />
      <OrgProfile data={data} />
      <ScopeTable data={data} />
      {SECTION_ORDER.map((key) => (
        <section key={key} className="report-preview__section">
          <h2>{headings[key]}</h2>
          {editable && !printMode ? (
            <textarea
              defaultValue={narrative[key]}
              rows={6}
              onChange={(e) => handleNarrativeEdit(key, e.target.value)}
              style={{ width: '100%' }}
            />
          ) : (
            <p>{narrative[key]}</p>
          )}
        </section>
      ))}
    </div>
  );
}

function CoverPage({ data }: { data: InventoryReportData }) {
  const lang = data.language;
  const orgName =
    lang !== 'en'
      ? (data.org.name_zh ?? data.org.name_en ?? '')
      : (data.org.name_en ?? data.org.name_zh ?? '');
  const title = m.report_preview_iso_title({}, { locale: lang });
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

function OrgProfile({ data }: { data: InventoryReportData }) {
  const lang = data.language;
  return (
    <section className="report-preview__org-profile">
      <h2>{m.report_preview_org_heading({}, { locale: lang })}</h2>
      <dl>
        <dt>{m.onboarding_step_company_industry({}, { locale: lang })}</dt>
        <dd>{data.org.industry ?? m.report_preview_not_provided({}, { locale: lang })}</dd>
        <dt>{m.report_preview_boundary_label({}, { locale: lang })}</dt>
        <dd>{reportBoundaryKindLabel(data.org.boundary_kind, lang)}</dd>
        <dt>{m.report_preview_responsible_label({}, { locale: lang })}</dt>
        <dd>
          {data.org.responsible.name ?? '—'}
          {data.org.responsible.role ? ` (${data.org.responsible.role})` : ''}
        </dd>
      </dl>
    </section>
  );
}

// Exported for reuse by TcfdReportPreview (spec 2026-07-22-tcfd-report) —
// the metrics pillar shows the same scope table the ISO report opens with.
export function ScopeTable({ data }: { data: InventoryReportData }) {
  const lang = data.language;
  const locale = { locale: lang };
  const labels = {
    scope: m.report_preview_scope({}, locale),
    scope1: m.report_preview_scope1({}, locale),
    scope2: m.report_preview_scope2({}, locale),
    scope3: m.report_preview_scope3({}, locale),
    total: m.report_preview_total({}, locale),
    biogenic: m.report_preview_biogenic({}, locale),
  };
  return (
    <section className="report-preview__scope-table">
      <h2>{m.report_preview_emissions_heading({}, locale)}</h2>
      <table>
        <thead>
          <tr>
            <th>{labels.scope}</th>
            <th>kg CO2e</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{labels.scope1}</td>
            <td>{formatCo2e(data.scope_totals.scope1_kg)}</td>
          </tr>
          <tr>
            <td>{labels.scope2}</td>
            <td>{formatCo2e(data.scope_totals.scope2_kg)}</td>
          </tr>
          <tr>
            <td>{labels.scope3}</td>
            <td>{formatCo2e(data.scope_totals.scope3_kg)}</td>
          </tr>
          <tr>
            <td>
              <strong>{labels.total}</strong>
            </td>
            <td>
              <strong>{formatCo2e(data.scope_totals.total_kg)}</strong>
            </td>
          </tr>
          <tr>
            <td>{labels.biogenic}</td>
            <td>{formatCo2e(data.scope_totals.biogenic_kg)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

/** Report labels follow the selected export language, independently of the UI. */
export function reportGranularityLabel(
  granularity: string,
  language: InventoryReportData['language'],
): string {
  const locale = { locale: language };
  switch (granularity) {
    case 'annual':
      return m.period_granularity_annual({}, locale);
    case 'quarterly':
      return m.period_granularity_quarterly({}, locale);
    case 'monthly':
      return m.period_granularity_monthly({}, locale);
    default:
      return granularity;
  }
}

function reportBoundaryKindLabel(
  boundary: string,
  language: InventoryReportData['language'],
): string {
  const locale = { locale: language };
  switch (boundary) {
    case 'equity_share':
      return m.settings_boundary_equity_share({}, locale);
    case 'financial_control':
      return m.settings_boundary_financial_control({}, locale);
    case 'operational_control':
      return m.settings_boundary_operational_control({}, locale);
    default:
      return boundary;
  }
}
