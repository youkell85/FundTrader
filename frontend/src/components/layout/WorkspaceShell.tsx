import { cn } from '@/lib/utils'

type WorkspaceShellProps = {
  children: React.ReactNode
  className?: string
  contentClassName?: string
  sidebar?: React.ReactNode
  withSidebar?: boolean
}

export default function WorkspaceShell({
  children,
  className,
  contentClassName,
  sidebar,
  withSidebar = false,
}: WorkspaceShellProps) {
  return (
    <div className={cn('workspace-shell min-h-screen pt-12', withSidebar && 'flex', className)}>
      {sidebar}
      <main className={cn('min-w-0 pb-24 md:pb-10', withSidebar ? 'flex-1' : '', contentClassName)}>
        {children}
      </main>
    </div>
  )
}
