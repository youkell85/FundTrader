import { Outlet } from 'react-router';
import SidebarNav from './SidebarNav';
import WorkspaceShell from './WorkspaceShell';
import { useAllocationStore } from '@/store/allocationStore';
import { isMockOutput } from '@/lib/execution-plan';
import RealAllocationRequired from '@/components/allocation/RealAllocationRequired';

export default function AllocationLayout() {
  const { state } = useAllocationStore();
  const hasRealOutput = !!state.output && !isMockOutput(state.output);

  return (
    <WorkspaceShell sidebar={<SidebarNav />} withSidebar contentClassName="flex-1">
      <div className="workspace-page-narrow">
        {hasRealOutput ? <Outlet /> : <RealAllocationRequired />}
      </div>
    </WorkspaceShell>
  );
}
