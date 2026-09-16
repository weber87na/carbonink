import * as m from '@renderer/paraglide/messages';

const LABEL_MAP: Record<string, () => string> = {
  'china_utility.v1': () => m.documents_type_utility(),
  'fuel_receipt.v1': () => m.documents_type_fuel(),
  'freight.v1': () => m.documents_type_freight(),
  'purchase.v1': () => m.documents_type_purchase(),
  'travel.v1': () => m.documents_type_travel(),
};

/**
 * Map a stage_id (or null) to a user-facing chip label.
 *
 * Resolve messages at render time so switching the UI locale also updates
 * existing document chips and the manual extraction selector.
 */
export function stageLabel(stageId: string | null | undefined): string {
  if (!stageId) return m.documents_status_unclassified();
  return LABEL_MAP[stageId]?.() ?? stageId;
}
