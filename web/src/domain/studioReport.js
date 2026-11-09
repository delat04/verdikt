/*  ============================================================================
    The ready-made report the dashboard opens on — three pages over the Studio tables:
      Money   what is held, released and returned, by month and by person, and every milestone
      Proof   how deliveries fare against the agreed checks, and what decided each check
      PayPal  every money movement with the PayPal id behind it
    AG Studio state (AgReportState). People change it freely; "Reset" brings this back.
    ============================================================================ */

const heading = (text) => ({ type: 'text', dataMapping: {}, format: { style: { text, typography: { fontSize: 18, fontWeight: 'normal' } } } })
const kpi = (id, caption) => ({ type: 'value', dataMapping: { value: [{ id }] }, format: { caption: { enabled: true, text: caption } } })
const titled = (text) => ({ title: { enabled: true, text, typography: { fontSize: 14, fontWeight: 'normal' } } })
const chart = (type, title, categoryKey, valueKey) => ({ type, dataMapping: { categoryKey, valueKey, tooltipKey: [] }, format: titled(title) })
const grid = (title, cols) => ({ type: 'grid', dataMapping: { cols }, format: { ...titled(title), style: { theme: { rowHeight: 32 } } } })
const at = (xTrack, yTrack, xSpan, ySpan) => ({ xTrack, yTrack, xSpan, ySpan })

export const DEFAULT_REPORT = {
  pages: [
    {
      id: 'money',
      widgets: {
        'money-heading': heading('Money held, released and returned'),
        'kpi-held': kpi('heldNow', 'Held in escrow now'),
        'kpi-released': kpi('releasedTotal', 'Released'),
        'kpi-returned': kpi('returnedTotal', 'Returned'),
        'kpi-days': kpi('avgDaysHeld', 'Average days held'),
        'by-month': chart('column-chart-grouped', 'Put in escrow and released, by month', [{ id: 'calendar::month' }], [{ id: 'heldIn' }, { id: 'releasedOut' }]),
        'by-person': chart('bar-chart-grouped', 'Released, by person', [{ id: 'milestones.with' }], [{ id: 'releasedTotal' }]),
        'by-status': chart('donut-chart', 'Where the money stands', [{ id: 'milestones.status' }], [{ id: 'milestones.amount', aggregation: 'sum' }]),
        'milestone-grid': grid('Every milestone', [
          { id: 'milestones.contract' }, { id: 'milestones.milestone' }, { id: 'milestones.with' }, { id: 'milestones.status' },
          { id: 'milestones.amount', aggregation: 'sum' }, { id: 'milestones.held', aggregation: 'sum' },
          { id: 'milestones.released', aggregation: 'sum' }, { id: 'milestones.fundedAt' }, { id: 'milestones.releasedAt' },
        ]),
      },
      widgetLayout: {
        'money-heading': at(0, 0, 24, 3),
        'kpi-held': at(0, 3, 6, 7),
        'kpi-released': at(6, 3, 6, 7),
        'kpi-returned': at(12, 3, 6, 7),
        'kpi-days': at(18, 3, 6, 7),
        'by-month': at(0, 10, 16, 22),
        'by-status': at(16, 10, 8, 22),
        'by-person': at(0, 32, 10, 24),
        'milestone-grid': at(10, 32, 14, 24),
      },
      filter: { page: [] },
    },
    {
      id: 'proof',
      widgets: {
        'proof-heading': heading('How deliveries meet the agreed checks'),
        'kpi-rate': kpi('checkRate', 'Checks met'),
        'kpi-first': kpi('firstTryRate', 'Passed on the first delivery'),
        'kpi-deliveries': kpi('avgDeliveries', 'Deliveries per milestone'),
        'kpi-run': kpi('checksRun', 'Checks run'),
        'by-kind': chart('bar-chart-grouped', 'Checks met, by kind', [{ id: 'checks.kind' }], [{ id: 'checkRate' }]),
        'decided-by': chart('donut-chart', 'What decided each check', [{ id: 'checks.decidedBy' }], [{ id: 'checksRun' }]),
        'by-attempt': chart('column-chart-grouped', 'Checks met, by delivery', [{ id: 'checks.attempt' }], [{ id: 'checkRate' }]),
        'check-grid': grid('Every check on every delivery', [
          { id: 'checks.contract' }, { id: 'checks.check' }, { id: 'checks.kind' }, { id: 'checks.attempt' },
          { id: 'checks.result' }, { id: 'checks.decidedBy' }, { id: 'checks.checkedAt' },
        ]),
      },
      widgetLayout: {
        'proof-heading': at(0, 0, 24, 3),
        'kpi-rate': at(0, 3, 6, 7),
        'kpi-first': at(6, 3, 6, 7),
        'kpi-deliveries': at(12, 3, 6, 7),
        'kpi-run': at(18, 3, 6, 7),
        'by-kind': at(0, 10, 9, 22),
        'by-attempt': at(9, 10, 7, 22),
        'decided-by': at(16, 10, 8, 22),
        'check-grid': at(0, 32, 24, 26),
      },
      filter: { page: [] },
    },
    {
      id: 'paypal',
      widgets: {
        'paypal-heading': heading('Every money movement, with the PayPal id behind it'),
        'by-type': chart('bar-chart-grouped', 'Money moved, by type', [{ id: 'payments.type' }], [{ id: 'payments.amount', aggregation: 'sum' }]),
        'payment-grid': grid('Movements', [
          { id: 'payments.at' }, { id: 'payments.contract' }, { id: 'payments.with' }, { id: 'payments.type' },
          { id: 'payments.amount', aggregation: 'sum' }, { id: 'payments.paypalId' },
        ]),
      },
      widgetLayout: {
        'paypal-heading': at(0, 0, 24, 3),
        'by-type': at(0, 3, 8, 30),
        'payment-grid': at(8, 3, 16, 30),
      },
      filter: { page: [] },
    },
  ],
  selectedPageId: 'money',
  // the assistant's panel opens with edit mode; the others wait until asked for
  panels: { ai: { collapsed: false }, edit: { collapsed: true }, data: { collapsed: true }, filters: { collapsed: true } },
}
