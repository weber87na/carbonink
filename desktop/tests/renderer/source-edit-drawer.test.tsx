vi.mock('@renderer/lib/api/emission-source', () => ({
  sourceApi: {
    update: vi.fn(),
  },
}));
vi.mock('@renderer/components/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { SourceEditDrawer } from '@renderer/components/SourceEditDrawer';
import { sourceApi } from '@renderer/lib/api/emission-source';
import type { EmissionSource } from '@shared/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const FAKE_SOURCE: EmissionSource = {
  id: 'src-1',
  site_id: 'site-1',
  name: 'Boiler #1',
  scope: 1,
  category: 'fuel.stationary',
  ghg_protocol_path: null,
  default_ef_query: null,
  template_origin: null,
  is_active: true,
};

describe('<SourceEditDrawer>', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('saves only the changed fields when name is edited', async () => {
    // Echo a sensible "updated" row back so the mutation's onSuccess runs
    // without blowing up on undefined.
    vi.mocked(sourceApi.update).mockResolvedValue({
      ...FAKE_SOURCE,
      name: 'Boiler #1 (renamed)',
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <SourceEditDrawer source={FAKE_SOURCE} open={true} onClose={onClose} />
      </QueryClientProvider>,
    );

    // Drawer mounts pre-populated from `source`.
    const nameInput = (await screen.findByLabelText(/^Name$|^名称$/i)) as HTMLInputElement;
    expect(nameInput.value).toBe('Boiler #1');

    // Change only the name; leave scope/category/is_active untouched.
    fireEvent.change(nameInput, { target: { value: 'Boiler #1 (renamed)' } });

    // Click Save. There are two buttons in the footer (Cancel + Save) —
    // disambiguate by name.
    const saveBtn = screen.getByRole('button', { name: /^Save$|^保存$/i });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(sourceApi.update).toHaveBeenCalled());

    const args = vi.mocked(sourceApi.update).mock.calls[0]?.[0];
    expect(args?.id).toBe('src-1');
    expect(args?.name).toBe('Boiler #1 (renamed)');
    // Optimistic diff: untouched fields must NOT be in the patch.
    expect(args?.scope).toBeUndefined();
    expect(args?.category).toBeUndefined();
    expect(args?.ghg_protocol_path).toBeUndefined();
    expect(args?.is_active).toBeUndefined();
  });

  describe('category picker', () => {
    async function openDrawer(source: EmissionSource) {
      vi.mocked(sourceApi.update).mockResolvedValue(source);
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={qc}>
          <SourceEditDrawer source={source} open={true} onClose={vi.fn()} />
        </QueryClientProvider>,
      );
      return (await screen.findByRole('combobox', {
        name: /Category|分类/i,
      })) as HTMLButtonElement;
    }

    function save() {
      fireEvent.click(screen.getByRole('button', { name: /^Save$|^保存$/i }));
      return waitFor(() => expect(sourceApi.update).toHaveBeenCalled()).then(
        () => vi.mocked(sourceApi.update).mock.calls[0]?.[0],
      );
    }

    it('shows a legacy category by its label, not its raw identifier', async () => {
      // The bug that started this: the field rendered "fuel.mobile".
      const trigger = await openDrawer({ ...FAKE_SOURCE, category: 'fuel.mobile' });
      expect(trigger.textContent).toContain('Mobile combustion');
      expect(trigger.textContent).not.toContain('fuel.mobile');
    });

    it('writes the standard code and derives the EF join key from one pick', async () => {
      const trigger = await openDrawer(FAKE_SOURCE);
      fireEvent.click(trigger);
      fireEvent.click(await screen.findByRole('option', { name: /Mobile combustion/ }));

      const args = await save();
      expect(args?.ghg_protocol_path).toBe('scope1.mobile_combustion');
      // `category` is not a second user decision — it's the EF-catalog
      // prefix `EfService.list` filters candidates by.
      expect(args?.category).toBe('fuel.mobile');
    });

    it('clears the EF join key for categories the catalog has no factors for', async () => {
      const trigger = await openDrawer(FAKE_SOURCE);
      fireEvent.click(trigger);
      fireEvent.click(await screen.findByRole('option', { name: /Fugitive emissions/ }));

      const args = await save();
      expect(args?.ghg_protocol_path).toBe('scope1.fugitive_emissions');
      // null, not undefined: leaving the stale `fuel.stationary` filter in
      // place would narrow the pool to the wrong factors. null hands the
      // matcher its scope-wide pool instead.
      expect(args?.category).toBeNull();
    });

    it('keeps a custom value as the category, leaving the standard field clear', async () => {
      const trigger = await openDrawer(FAKE_SOURCE);
      fireEvent.click(trigger);
      fireEvent.change(await screen.findByPlaceholderText(/Search categories/i), {
        target: { value: 'data_center_PUE' },
      });
      fireEvent.click(await screen.findByRole('option', { name: /data_center_PUE/ }));

      const args = await save();
      // Free text keeps its historical meaning — it IS the category — so
      // only standard codes ever reach ghg_protocol_path.
      expect(args?.category).toBe('data_center_PUE');
      expect(args?.ghg_protocol_path).toBeNull();
    });

    it('can clear the category entirely', async () => {
      const trigger = await openDrawer(FAKE_SOURCE);
      fireEvent.click(trigger);
      fireEvent.click(await screen.findByRole('option', { name: 'Not set' }));

      const args = await save();
      // null rather than undefined, or the patch would drop the field and
      // the clear would be a silent no-op.
      expect(args?.category).toBeNull();
      expect(args?.ghg_protocol_path).toBeNull();
    });

    it('resets the pick when the scope changes', async () => {
      const trigger = await openDrawer({
        ...FAKE_SOURCE,
        category: 'fuel.stationary',
        ghg_protocol_path: 'scope1.stationary_combustion',
      });
      expect(trigger.textContent).toContain('Stationary combustion');

      // A scope 1 category under scope 3 is a contradiction.
      fireEvent.click(screen.getByLabelText(/Scope 3|范围 3/i));
      await waitFor(() => expect(trigger.textContent).toContain('Select a category'));

      const args = await save();
      expect(args?.scope).toBe(3);
      expect(args?.category).toBeNull();
      expect(args?.ghg_protocol_path).toBeNull();
    });
  });
});
