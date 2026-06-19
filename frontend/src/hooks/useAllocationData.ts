import { useMemo } from 'react';
import { useAllocationStore } from '@/store/allocationStore';
import { isMockOutput } from '@/lib/execution-plan';
import type { AllocationResponse, VariantsResponse } from '@/types/allocation';

export interface AllocationData {
  d: AllocationResponse;
  saa: AllocationResponse['saa'];
  taa: AllocationResponse['taa'];
  funds: AllocationResponse['funds'];
  mc: AllocationResponse['monte_carlo'];
  st: AllocationResponse['stress_tests'];
  pm: AllocationResponse['portfolio_metrics'];
  constraints: AllocationResponse['constraints'];
  meta: AllocationResponse['meta'];
  isMock: boolean;
  isReal: boolean;
}

export function useAllocationData(): AllocationData & { variants: VariantsResponse | null } {
  const storeState = useAllocationStore().state;
  const storeOutput = storeState?.output ?? null;

  if (!storeOutput || isMockOutput(storeOutput)) {
    throw new Error('Real allocation output is required before rendering allocation result pages.');
  }

  const d = storeOutput;

  return useMemo(() => ({
    d,
    saa: d.saa,
    taa: d.taa,
    funds: d.funds,
    mc: d.monte_carlo,
    st: d.stress_tests,
    pm: d.portfolio_metrics,
    constraints: d.constraints,
    meta: d.meta,
    isMock: false,
    isReal: true,
    variants: storeState?.variants ?? null,
  }), [d, storeState?.variants]);
}

export function useGuardedAllocationData(): AllocationData & { variants: VariantsResponse | null; guardMessage?: string } {
  const base = useAllocationData();
  return useMemo(() => base, [base]);
}
