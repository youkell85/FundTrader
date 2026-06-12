import { Outlet } from 'react-router';
import SidebarNav from './SidebarNav';

export default function AllocationLayout() {
  return (
    <div className="min-h-screen pt-12 flex">
      <SidebarNav />
      <main className="flex-1 min-w-0 md:ml-52">
        <div className="max-w-[960px] mx-auto px-4 md:px-6 pb-20">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
