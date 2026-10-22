import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, testnetApi, type PersonalBaskets } from "./api";

// Testnet UI is shown only when VITE_TESTNET_API_URL is set and its /api/health answers.
// Personal mode is shown only when that instance serves /api/personal/baskets.
interface Instances {
  testnetUp: boolean;
  personal: PersonalBaskets | null;
  ready: boolean;
}

const Ctx = createContext<Instances>({ testnetUp: false, personal: null, ready: false });

export function InstancesProvider({ children }: { children: ReactNode }) {
  const [v, setV] = useState<Instances>({ testnetUp: false, personal: null, ready: !testnetApi });

  useEffect(() => {
    if (!testnetApi) return;
    let alive = true;
    const check = async () => {
      let testnetUp = false;
      let personal: PersonalBaskets | null = null;
      try {
        await testnetApi!.health();
        testnetUp = true;
        personal = await testnetApi!.get<PersonalBaskets>("/api/personal/baskets").catch((e) => {
          if (e instanceof ApiError && e.status === 404) return null;
          throw e;
        });
      } catch {
        /* instance down: hide testnet UI */
      }
      if (alive) setV({ testnetUp, personal, ready: true });
    };
    check();
    const t = setInterval(check, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

export const useInstances = () => useContext(Ctx);
