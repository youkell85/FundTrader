import { Outlet } from 'react-router';
import SidebarNav from './SidebarNav';
import { useAllocationStore } from '@/store/allocationStore';
import { isMockOutput } from '@/lib/execution-plan';
import RealAllocationRequired from '@/components/allocation/RealAllocationRequired';

export default function AllocationLayout() {
  const { state } = useAllocationStore();
  const hasRealOutput = !!state.output && !isMockOutput(state.output);

  return (
    <div className="workspace-shell min-h-screen pt-12 flex">
      <SidebarNav />
      <main className="flex-1 min-w-0 md:ml-52">
        <div className="max-w-[960px] mx-auto px-4 md:px-6 pb-20">
          {hasRealOutput ? <Outlet /> : <RealAllocationRequired />}
        </div>
      </main>
    </div>
  );
}
