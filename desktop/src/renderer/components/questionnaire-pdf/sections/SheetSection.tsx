import type { QuestionnairePdfData } from '@shared/types';
import { QuestionAnswerRow } from './QuestionAnswerRow';

export function SheetSection({
  sheet,
  language,
}: {
  sheet: QuestionnairePdfData['sheets'][number];
  language: QuestionnairePdfData['language'];
}) {
  return (
    <section className="qpdf__sheet">
      <h2>{sheet.sheet_name}</h2>
      {sheet.questions.map((q, i) => (
        <QuestionAnswerRow key={q.id} question={q} index={i} language={language} />
      ))}
    </section>
  );
}
