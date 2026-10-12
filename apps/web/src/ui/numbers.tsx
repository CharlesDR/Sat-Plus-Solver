/**
 * How the plan writes its numbers (UX-6, A78): quiet (1 to 2 decimals,
 * "<0.01" for dust) by default, or precise (A41: 1 to 4 decimals with exact
 * fractions) when the user asks. Exact values stay in tooltips either way.
 */
import { quietText, rateText } from '@sps/graph';
import { PRECISE_NUMBERS, QUIET_NUMBERS, type NumberFormat } from '@sps/solver';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { usePreciseNumbers } from './prefs';

export interface Numbers extends NumberFormat {
  precise: boolean;
  /** The graph package's copy of `rate`, for the flowchart layout. */
  graphRate(n: number): string;
  setPrecise(precise: boolean): void;
}

const quiet: Numbers = {
  ...QUIET_NUMBERS,
  precise: false,
  graphRate: quietText,
  setPrecise: () => {},
};

const NumbersContext = createContext<Numbers>(quiet);

export function NumbersProvider({ children }: { children: ReactNode }) {
  const [precise, setPrecise] = usePreciseNumbers();
  const value = useMemo<Numbers>(
    () =>
      precise
        ? { ...PRECISE_NUMBERS, precise, graphRate: rateText, setPrecise }
        : { ...quiet, setPrecise },
    [precise, setPrecise],
  );
  return <NumbersContext.Provider value={value}>{children}</NumbersContext.Provider>;
}

export const useNumbers = () => useContext(NumbersContext);
