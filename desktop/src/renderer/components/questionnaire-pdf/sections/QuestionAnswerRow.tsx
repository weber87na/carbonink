import * as m from '@renderer/paraglide/messages';
import type { QuestionnairePdfData } from '@shared/types';

type Question = QuestionnairePdfData['sheets'][number]['questions'][number];

export function QuestionAnswerRow({
  question,
  index,
  language,
}: {
  question: Question;
  index: number;
  language: QuestionnairePdfData['language'];
}) {
  return (
    <div className="qpdf__qa">
      <div className="qpdf__qa-q">
        Q{index + 1}. {question.raw_text}
      </div>
      {question.parsed_intent && <div className="qpdf__qa-intent">{question.parsed_intent}</div>}
      <AnswerBlock question={question} language={language} />
    </div>
  );
}

function AnswerBlock({
  question,
  language,
}: {
  question: Question;
  language: QuestionnairePdfData['language'];
}) {
  const a = question.answer;
  if (a == null) {
    return (
      <div className="qpdf__qa-a qpdf__qa-unanswered">
        {m.questionnaire_pdf_unanswered({}, { locale: language })}
      </div>
    );
  }
  const unit = a.unit ? ` ${a.unit}` : '';
  const badge =
    a.finalized_at == null ? (
      <span className="qpdf__qa-badge qpdf__qa-badge--draft">
        {m.questionnaire_pdf_draft({}, { locale: language })}
      </span>
    ) : (
      <span className="qpdf__qa-badge qpdf__qa-badge--final">
        {m.questionnaire_pdf_finalized({}, { locale: language })}
      </span>
    );
  return (
    <div className="qpdf__qa-a">
      {a.value}
      {unit}
      {badge}
      {a.source_summary && (
        <div className="qpdf__qa-source">
          {m.questionnaire_pdf_source_summary({}, { locale: language })}: {a.source_summary}
        </div>
      )}
    </div>
  );
}
