import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { heroApi, testnetApi, type RunDetail } from "./lib/api";
import { InstancesProvider, useInstances } from "./lib/instances";
import { LiveProvider } from "./lib/live";
import { Layout } from "./components/Layout";
import { useSession } from "./lib/session";
import { LinkButton, Page } from "./components/ui";
import { AdminPage } from "./pages/AdminPage";
import { BasketPage } from "./pages/BasketPage";
import { ConnectPage } from "./pages/ConnectPage";
import { HowPage } from "./pages/HowPage";
import { MePage, meApi } from "./pages/MePage";
import { RebalancePage, RunsPage } from "./pages/RebalancePage";

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: true, staleTime: 5_000 } } });

function TestnetOnly({ children }: { children: React.ReactNode }) {
  const { testnetUp, ready } = useInstances();
  if (ready && !testnetUp)
    return (
      <Page className="py-24 text-center text-dim">
        The testnet engine is offline right now. Try again in a minute.
        <div className="mt-5"><LinkButton to="/">Back to the basket</LinkButton></div>
      </Page>
    );
  return <>{children}</>;
}

function RequireToken({ children }: { children: React.ReactNode }) {
  return useSession().token ? <>{children}</> : <Navigate to="/connect" replace />;
}

function NotFound() {
  return (
    <Page className="py-28 text-center">
      <h1 className="gradient-text font-display text-[54px] font-bold">Lost in orbit</h1>
      <p className="mt-3 text-dim">That page doesn't exist.</p>
      <div className="mt-6"><LinkButton to="/" variant="plasma">Back to the basket</LinkButton></div>
    </Page>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <InstancesProvider>
        <LiveProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<BasketPage api={heroApi} variant="hero" />} />
                <Route path="rebalances" element={<RunsPage api={heroApi} linkBase="/rebalances" back="/" backLabel="Pre-IPO" />} />
                <Route path="rebalances/:id" element={<RebalancePage api={heroApi} back="/" backLabel="Pre-IPO" />} />
                <Route path="how" element={<HowPage />} />
                <Route path="admin" element={<AdminPage />} />
                {testnetApi && (
                  <>
                    <Route path="testnet" element={<TestnetOnly><BasketPage api={testnetApi} variant="testnet" /></TestnetOnly>} />
                    <Route path="testnet/rebalances" element={<TestnetOnly><RunsPage api={testnetApi} linkBase="/testnet/rebalances" back="/testnet" backLabel="Testnet vault" /></TestnetOnly>} />
                    <Route path="testnet/rebalances/:id" element={<TestnetOnly><RebalancePage api={testnetApi} back="/testnet" backLabel="Testnet vault" /></TestnetOnly>} />
                    <Route path="connect" element={<TestnetOnly><ConnectPage /></TestnetOnly>} />
                    <Route path="me" element={<TestnetOnly><RequireToken><MePage /></RequireToken></TestnetOnly>} />
                    <Route
                      path="me/rebalances/:id"
                      element={
                        <TestnetOnly>
                          <RequireToken>
                            <RebalancePage
                              api={testnetApi}
                              back="/me"
                              backLabel="My basket"
                              live={false}
                              load={(id) => meApi().get<RunDetail>(`/api/me/rebalances/${encodeURIComponent(id)}`)}
                            />
                          </RequireToken>
                        </TestnetOnly>
                      }
                    />
                  </>
                )}
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </LiveProvider>
      </InstancesProvider>
    </QueryClientProvider>
  );
}
