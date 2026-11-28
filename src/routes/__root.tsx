import { isAndroidStudio } from '@/lib/androidStudio'
import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import { AppHeader } from '@/components/layout/AppHeader'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { RecipeDock } from '@/components/layout/RecipeDock'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
})

function RootLayout() {
  if (isAndroidStudio()) return <TooltipProvider>
    <div className="flex min-h-dvh min-w-0 flex-col bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <header className="sticky top-0 z-40 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="text-sm font-semibold">角色合成 · 个人版</span>
          <nav aria-label="主要页面" className="flex flex-wrap gap-1">
            <Link to="/studio" className="flex min-h-11 items-center rounded-lg px-3 text-sm" activeProps={{ className: 'bg-primary/10 font-semibold text-primary' }}>合成台</Link>
            <Link to="/studio2" search={{ source: undefined }} className="flex min-h-11 items-center rounded-lg px-2 text-sm" activeProps={{ className: 'bg-primary/10 font-semibold text-primary' }}>合成台 2</Link>
            <Link to="/poses" className="flex min-h-11 items-center rounded-lg px-2 text-sm" activeProps={{ className: 'bg-primary/10 font-semibold text-primary' }}>姿势库</Link>
            <Link to="/settings" className="flex min-h-11 items-center rounded-lg px-3 text-sm" activeProps={{ className: 'bg-primary/10 font-semibold text-primary' }}>设置</Link>
          </nav>
        </div>
      </header>
      <main className="@container/main mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-4 px-4 pt-4 pb-8"><Outlet /></main>
    </div>
    <Toaster />
  </TooltipProvider>
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <AppHeader />
          <main className="@container/main flex min-w-0 flex-1 flex-col px-4 pt-4 pb-10 sm:px-6 md:px-8">
            <div className="mx-auto flex min-w-0 w-full max-w-7xl flex-1 flex-col gap-4 md:gap-6">
              <Outlet />
            </div>
            <RecipeDock />
          </main>
        </SidebarInset>
      </SidebarProvider>
      <Toaster />
    </TooltipProvider>
  )
}

