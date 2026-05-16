import { useContext } from 'react';
import { UIContext, type UICtxValue } from './ui-context';

export function useUI(): UICtxValue {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used inside <UIProvider>');
  return ctx;
}
