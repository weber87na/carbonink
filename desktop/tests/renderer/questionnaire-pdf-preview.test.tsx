import { QuestionnairePdfPreview } from '@renderer/components/questionnaire-pdf/QuestionnairePdfPreview';
import { setLocale } from '@renderer/paraglide/runtime';
import type { QuestionnairePdfData } from '@shared/types';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  cleanup();
  setLocale('en', { reload: false });
});

const data: QuestionnairePdfData = {
  customer: { name: 'Acme Corp' },
  questionnaire: {
    id: 'qn-1',
    reporting_year: 2025,
    due_date: '2025-12-31',
    created_at: '2025-06-01T00:00:00Z',
    status: 'answering',
  },
  document: { filename: 'cdp.xlsx' },
  sheets: [
    {
      sheet_name: 'Sheet1',
      questions: [
        {
          id: 'q-1',
          position: 'Sheet1!B5',
          raw_text: 'Total employees',
          normalized_text: 'total employees',
          parsed_intent: null,
          question_kind: 'numerical',
          expected_unit: '人',
          answer: {
            value: '320',
            unit: '人',
            finalized_at: '2026-05-01T00:00:00Z',
            source_summary: null,
          },
        },
        {
          id: 'q-2',
          position: 'Sheet1!C3',
          raw_text: 'Company industry',
          normalized_text: 'company industry',
          parsed_intent: 'pick a category',
          question_kind: 'categorical',
          expected_unit: null,
          answer: { value: 'Manufacturing', unit: null, finalized_at: null, source_summary: null }, // draft
        },
        {
          id: 'q-3',
          position: 'Sheet1!D2',
          raw_text: 'Notes',
          normalized_text: 'notes',
          parsed_intent: null,
          question_kind: 'narrative',
          expected_unit: null,
          answer: null, // unanswered
        },
      ],
    },
  ],
  language: 'en',
};

describe('<QuestionnairePdfPreview>', () => {
  it('uses Traditional Chinese labels throughout the document while preserving customer content', () => {
    setLocale('en', { reload: false });
    render(
      <QuestionnairePdfPreview
        data={{
          ...data,
          language: 'zh-TW',
          customer: { name: '测试公司' },
          sheets: [
            ...data.sheets,
            {
              sheet_name: 'Additional questions',
              questions: [
                {
                  id: 'q-4',
                  position: 'Additional questions!B5',
                  raw_text: '供应商信息',
                  normalized_text: '供应商信息',
                  parsed_intent: null,
                  question_kind: 'narrative',
                  expected_unit: null,
                  answer: {
                    value: '保留原文',
                    unit: null,
                    finalized_at: null,
                    source_summary: '组织原始资料',
                  },
                },
              ],
            },
          ],
        }}
      />,
    );
    expect(screen.getByText('目錄')).toBeTruthy();
    expect(screen.getByText(/產生時間:/)).toBeTruthy();
    expect(screen.getByText('截止日期: 2025-12-31')).toBeTruthy();
    expect(screen.getByText('已定稿')).toBeTruthy();
    expect(screen.getAllByText('草稿')).toHaveLength(2);
    expect(screen.getByText('(未答)')).toBeTruthy();
    expect(screen.getByText('來源: 组织原始资料')).toBeTruthy();
    expect(screen.getByText('测试公司')).toBeTruthy();
    expect(screen.getByText(/供应商信息/)).toBeTruthy();
    expect(screen.getByText(/保留原文/)).toBeTruthy();
    expect(screen.queryByText('DRAFT')).toBeNull();
  });

  it('keeps an English export in English when the UI uses Traditional Chinese', () => {
    setLocale('zh-TW', { reload: false });
    render(<QuestionnairePdfPreview data={data} />);
    expect(screen.getByText(/Generated:/)).toBeTruthy();
    expect(screen.getByText('Finalized')).toBeTruthy();
    expect(screen.getByText('DRAFT')).toBeTruthy();
    expect(screen.getByText('(Unanswered)')).toBeTruthy();
    expect(screen.queryByText('草稿')).toBeNull();
  });

  it('renders cover page + sheet section with questions', () => {
    render(<QuestionnairePdfPreview data={data} />);
    expect(screen.getByText('Acme Corp')).toBeTruthy();
    expect(screen.getByText(/Sheet1/)).toBeTruthy();
    expect(screen.getByText(/Total employees/)).toBeTruthy();
    expect(screen.getByText(/320/)).toBeTruthy();
  });

  it('renders DRAFT badge for un-finalized answers and Unanswered for null answers', () => {
    render(<QuestionnairePdfPreview data={data} />);
    // StrictMode may double-render, so use getAllByText.
    expect(screen.getAllByText(/DRAFT|草稿/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Unanswered|未答/).length).toBeGreaterThan(0);
  });
});
