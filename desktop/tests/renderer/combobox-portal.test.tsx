import { Combobox } from '@renderer/components/ui/combobox';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Where the popover portal mounts is load-bearing, not cosmetic.
 *
 * vaul drawers and Radix dialogs mount react-remove-scroll with their own
 * content element as its only shard, and it cancels wheel events targeting
 * anything outside that subtree. A popover portaled to document.body — the
 * Radix default — therefore renders fine and clicks fine but refuses to
 * scroll. It only bites once a list is long enough to overflow, which is
 * why it went unnoticed until the 15 Scope 3 emission categories.
 */

const GROUPS = [
  {
    options: Array.from({ length: 20 }, (_, i) => ({ value: `opt-${i}`, label: `Option ${i}` })),
  },
];

function combobox() {
  return (
    <Combobox
      value=""
      onValueChange={vi.fn()}
      groups={GROUPS}
      placeholder="Pick one"
      searchPlaceholder="Search…"
      emptyText="Nothing"
    />
  );
}

describe('<Combobox> portal host', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('mounts inside the surrounding drawer so the list stays scrollable', () => {
    render(<div data-vaul-drawer="">{combobox()}</div>);
    fireEvent.click(screen.getByRole('combobox'));

    const option = screen.getByText('Option 0');
    expect(option.closest('[data-vaul-drawer]')).not.toBeNull();
  });

  it('mounts inside a dialog for the same reason', () => {
    render(<div data-slot="dialog-content">{combobox()}</div>);
    fireEvent.click(screen.getByRole('combobox'));

    expect(screen.getByText('Option 0').closest('[data-slot="dialog-content"]')).not.toBeNull();
  });

  it('falls back to the document body on a plain page', () => {
    render(<div data-testid="plain">{combobox()}</div>);
    fireEvent.click(screen.getByRole('combobox'));

    // No scroll-locking ancestor to worry about, so Radix's default is
    // right — and keeps the popover clear of any ancestor stacking or
    // clipping context.
    expect(screen.getByText('Option 0').closest('[data-testid="plain"]')).toBeNull();
  });
});
