import { useState } from 'react';

const TABS = ['Home', 'Insert', 'Formulas', 'Data', 'Review', 'View'] as const;
type Tab = (typeof TABS)[number];

type RibbonGroup = {
  label: string;
  buttons: { id: string; label: string; symbol: string; ariaPressed?: boolean }[];
};

/**
 * Phase 0: visual scaffold of the Home tab only.
 * Phase 1 wires each button to `api.executeCommand('sheet.command.*', ...)`.
 */
const HOME_GROUPS: RibbonGroup[] = [
  {
    label: 'Clipboard',
    buttons: [
      { id: 'paste', label: 'Paste', symbol: '⎘' },
      { id: 'cut', label: 'Cut', symbol: '✂' },
      { id: 'copy', label: 'Copy', symbol: '⎘' },
    ],
  },
  {
    label: 'Font',
    buttons: [
      { id: 'bold', label: 'Bold', symbol: 'B' },
      { id: 'italic', label: 'Italic', symbol: 'I' },
      { id: 'underline', label: 'Underline', symbol: 'U' },
    ],
  },
  {
    label: 'Alignment',
    buttons: [
      { id: 'align-left', label: 'Align left', symbol: '⇤' },
      { id: 'align-center', label: 'Center', symbol: '↔' },
      { id: 'align-right', label: 'Align right', symbol: '⇥' },
    ],
  },
  {
    label: 'Number',
    buttons: [
      { id: 'numfmt-currency', label: 'Currency', symbol: '$' },
      { id: 'numfmt-percent', label: 'Percent', symbol: '%' },
    ],
  },
];

export function Ribbon() {
  const [active, setActive] = useState<Tab>('Home');

  return (
    <nav className="ribbon" data-testid="ribbon" aria-label="Ribbon">
      <div className="ribbon__tabs" role="tablist">
        <button
          type="button"
          className="ribbon__tab ribbon__tab--file"
          data-testid="ribbon-tab-file"
        >
          File
        </button>
        {TABS.map((tab) => (
          <button
            type="button"
            key={tab}
            role="tab"
            aria-selected={active === tab}
            className="ribbon__tab"
            data-testid={`ribbon-tab-${tab.toLowerCase()}`}
            onClick={() => setActive(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div
        className="ribbon__body"
        role="tabpanel"
        data-testid={`ribbon-body-${active.toLowerCase()}`}
      >
        {active === 'Home' ? (
          HOME_GROUPS.map((group) => <RibbonGroupView key={group.label} group={group} />)
        ) : (
          <span className="ribbon__empty" data-testid="ribbon-empty">
            {active} tab — coming in Phase 1
          </span>
        )}
      </div>
    </nav>
  );
}

function RibbonGroupView({ group }: { group: RibbonGroup }) {
  return (
    <div className="ribbon__group" data-testid={`ribbon-group-${group.label.toLowerCase()}`}>
      <div className="ribbon__group-body">
        {group.buttons.map((b) => (
          <button
            key={b.id}
            type="button"
            className="btn btn--icon"
            data-testid={`ribbon-btn-${b.id}`}
            aria-label={b.label}
            title={b.label}
            disabled
          >
            <span aria-hidden="true">{b.symbol}</span>
          </button>
        ))}
      </div>
      <div className="ribbon__group-label">{group.label}</div>
    </div>
  );
}
