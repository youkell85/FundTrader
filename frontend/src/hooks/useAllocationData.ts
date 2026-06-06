import { useMemo } from 'react';
import { useAllocationStore } from '@/store/allocationStore';
import { MOCK_DATA } from '@/pages/mockData';
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
  /** true 表示 store 中有真实 output（非 MOCK_DATA 回退），可执行回测/保存/排名 */
  isReal: boolean;
}

export function useAllocationData(): AllocationData & { variants: VariantsResponse | null } {
  const storeState = useAllocationStore().state;
  const storeOutput = storeState?.output ?? null;

  const d = storeOutput || MOCK_DATA;
  const isMock = !storeOutput || isMockOutput(storeOutput);

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
    isMock,
    isReal: !isMock,
    variants: storeState?.variants ?? null,
  }), [d, isMock, storeState?.variants]);
}

/**
 * 用于可执行页面（回测、保存、排名）。
 * isMock=true 时返回的数据仍可用于展示，但调用侧必须阻断执行动作。
 */
export function useGuardedAllocationData(): AllocationData & { variants: VariantsResponse | null; guardMessage?: string } {
  const base = useAllocationData();
  return useMemo(() => {
    if (base.isMock) {
      return { ...base, guardMessage: '当前为演示数据，请先生成真实配置方案' };
    }
    return base;
  }, [base]);
}
