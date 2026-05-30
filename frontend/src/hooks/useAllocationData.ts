import { useMemo } from 'react';
import { useAllocationStore } from '@/store/allocationStore';
import { MOCK_DATA } from '@/pages/mockData';
import type { AllocationResponse, MarketDataStatus } from '@/types/allocation';

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
}

export function useAllocationData(): AllocationData {
  const storeState = useAllocationStore().state;
  const storeOutput = storeState?.output ?? null;

  const d = storeOutput || MOCK_DATA;

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
    isMock: !storeOutput,
  }), [d, storeOutput]);
}
