import { useUniverAPI } from '../../use-univer';
import { useActiveCellState } from '../../hooks/useActiveCellState';
import { applyAutoFunction } from '../tab-actions';
import { RibbonGroup, ToolbarButton } from '../RibbonControls';

export function FormulasTab() {
  const api = useUniverAPI();
  const { ready } = useActiveCellState();
  const enabled = Boolean(api) && ready;

  return (
    <>
      <RibbonGroup label="Function library">
        <ToolbarButton
          id="auto-sum"
          label="AutoSum — Σ"
          icon="functions"
          disabled={!enabled}
          onClick={() => api && applyAutoFunction(api, 'SUM')}
        />
        <ToolbarButton
          id="auto-avg"
          label="Average"
          icon="bar_chart"
          disabled={!enabled}
          onClick={() => api && applyAutoFunction(api, 'AVERAGE')}
        />
        <ToolbarButton
          id="auto-count"
          label="Count"
          icon="numbers"
          disabled={!enabled}
          onClick={() => api && applyAutoFunction(api, 'COUNT')}
        />
        <ToolbarButton
          id="auto-min"
          label="Min"
          icon="south"
          disabled={!enabled}
          onClick={() => api && applyAutoFunction(api, 'MIN')}
        />
        <ToolbarButton
          id="auto-max"
          label="Max"
          icon="north"
          disabled={!enabled}
          onClick={() => api && applyAutoFunction(api, 'MAX')}
        />
      </RibbonGroup>
    </>
  );
}
