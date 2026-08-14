import { EmissionCategoryPicker } from '@renderer/components/EmissionCategoryPicker';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The picker that replaced the free-text category field. What matters:
 * the options are scoped, the labels are localized (the old field showed
 * raw identifiers like `fuel.mobile`), and values outside the taxonomy
 * survive instead of being silently dropped.
 */

function harness(props: Partial<React.ComponentProps<typeof EmissionCategoryPicker>> = {}) {
  const onChange = vi.fn();
  render(
    <EmissionCategoryPicker
      id="cat"
      scope={props.scope ?? 1}
      value={props.value ?? ''}
      onChange={props.onChange ?? onChange}
    />,
  );
  return { onChange: props.onChange ?? onChange };
}

const optionNames = () => screen.getAllByRole('option').map((o) => o.textContent ?? '');

describe('<EmissionCategoryPicker>', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('offers only the picked scope’s categories', async () => {
    harness({ scope: 1 });
    fireEvent.click(screen.getByRole('combobox'));

    await waitFor(() => {
      const names = optionNames();
      expect(names.some((n) => n.includes('Stationary combustion'))).toBe(true);
      expect(names.some((n) => n.includes('Mobile combustion'))).toBe(true);
      expect(names.some((n) => n.includes('Process emissions'))).toBe(true);
      expect(names.some((n) => n.includes('Fugitive emissions'))).toBe(true);
      // Scope 3 categories must not leak into a scope 1 source.
      expect(names.some((n) => n.includes('Business travel'))).toBe(false);
      expect(names).toHaveLength(4);
    });
  });

  it('numbers scope 3 categories and splits them upstream / downstream', async () => {
    harness({ scope: 3 });
    fireEvent.click(screen.getByRole('combobox'));

    await waitFor(() => {
      const names = optionNames();
      expect(names).toHaveLength(15);
      // The standard's own numbering — what CDP/CSRD tables key on.
      expect(names.some((n) => n.includes('3.6 Business travel'))).toBe(true);
      expect(names.some((n) => n.includes('3.15 Investments'))).toBe(true);
    });
    expect(screen.getByText(/Upstream \(3\.1–3\.8\)/)).toBeTruthy();
    expect(screen.getByText(/Downstream \(3\.9–3\.15\)/)).toBeTruthy();
  });

  it('reports the standard code, not the label', async () => {
    const { onChange } = harness({ scope: 3 });
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: /3\.6 Business travel/ }));

    expect(onChange).toHaveBeenCalledWith('scope3.cat6_business_travel');
  });

  it('shows a localized label for the selected code', () => {
    harness({ scope: 1, value: 'scope1.mobile_combustion' });
    // The complaint that started this: the field used to render the raw
    // stored identifier.
    expect(screen.getByRole('combobox').textContent).toContain('Mobile combustion');
    expect(screen.getByRole('combobox').textContent).not.toContain('scope1.mobile_combustion');
  });

  it('surfaces a legacy value as the current, non-standard pick', async () => {
    harness({ scope: 1, value: 'fuel.mobile' });

    // Humanized in the trigger via the historical label map…
    expect(screen.getByRole('combobox').textContent).toContain('Mobile combustion');

    // …and pinned at the top of the list, badged, so the user can see
    // what they're replacing rather than losing it.
    fireEvent.click(screen.getByRole('combobox'));
    await waitFor(() => {
      expect(screen.getByText('Current value')).toBeTruthy();
      expect(screen.getByText('Non-standard')).toBeTruthy();
    });
  });

  it('can clear a set category', async () => {
    const { onChange } = harness({ scope: 1, value: 'scope1.mobile_combustion' });
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'Not set' }));

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('offers no clear row when nothing is set', async () => {
    harness({ scope: 1, value: '' });
    fireEvent.click(screen.getByRole('combobox'));
    await waitFor(() => expect(optionNames()).toHaveLength(4));
    expect(screen.queryByRole('option', { name: 'Not set' })).toBeNull();
  });

  it('filters on both locales and on the raw code', async () => {
    harness({ scope: 3 });
    fireEvent.click(screen.getByRole('combobox'));
    const search = await screen.findByPlaceholderText(/Search categories/i);

    // A zh-CN term against an en-rendered list — consultants search in
    // whichever language the source document used.
    fireEvent.change(search, { target: { value: '商务差旅' } });
    await waitFor(() => {
      expect(optionNames().some((n) => n.includes('3.6 Business travel'))).toBe(true);
    });

    // And the stored code itself, for anyone pasting from a spreadsheet.
    fireEvent.change(search, { target: { value: 'cat15' } });
    await waitFor(() => {
      expect(optionNames().some((n) => n.includes('3.15 Investments'))).toBe(true);
    });
  });
});
