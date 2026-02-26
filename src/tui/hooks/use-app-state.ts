import { useState, useEffect } from 'react';
import type { TuiStore, TuiState } from '../store';

export function useAppState(store: TuiStore): TuiState {
  const [state, setState] = useState<TuiState>({ ...store.state });

  useEffect(() => {
    const handler = (newState: TuiState) => setState({ ...newState });
    store.on('change', handler);
    return () => {
      store.off('change', handler);
    };
  }, [store]);

  return state;
}
