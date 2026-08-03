import { cn } from '@renderer/lib/utils';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The one empty state used across list surfaces.
 *
 * Before this existed every "nothing here yet" was a bare muted <p>, which
 * under-explains twice over: it doesn't say what the thing is FOR, and it
 * doesn't say what to do next. `/activities` was the worst case — it told
 * users to click "Add activity", but with zero emission sources that drawer
 * can't be submitted, so the advice was a dead end.
 *
 * Shape follows the dashed-border pattern the filter-empty states already
 * use (see `/sources` "no matches"), so an empty list and a filtered-to-nothing
 * list read as the same family. Border, not fill — cards stay pure white
 * (DESIGN.md, No-Fill-For-Cards).
 *
 * `actions` should carry at most one filled `Button` (One Mark Rule); a
 * second choice goes in as `variant="outline"`.
 */
export interface EmptyStateProps {
  /** Optional lucide glyph, rendered large + muted above the title. */
  icon?: LucideIcon;
  title: string;
  /** One or two sentences: what this surface holds, and what to do next. */
  body: string;
  actions?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, body, actions, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border px-8 py-12 text-center',
        className,
      )}
    >
      {Icon && (
        <Icon className="size-10 text-muted-foreground/50" strokeWidth={1.5} aria-hidden="true" />
      )}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
      {actions && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{actions}</div>
      )}
    </div>
  );
}
