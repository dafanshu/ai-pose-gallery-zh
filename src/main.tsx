import { isHarness } from '@/lib/runtime'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { StudioProvider } from '@/store/studioStore'
import { routeTree } from './routeTree.gen'
import './index.css'
import './notifications.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

const router = createRouter({
  routeTree,
  history: isHarness() ? createMemoryHistory({ initialEntries: ['/studio'] }) : undefined,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
  interface StaticDataRouteOption {
    title?: string
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <StudioProvider>
          <RouterProvider router={router} />
        </StudioProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>
)
