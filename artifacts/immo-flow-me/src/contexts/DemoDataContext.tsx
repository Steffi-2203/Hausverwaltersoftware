import { createContext, useContext, type ReactNode } from 'react';

interface DemoDataContextType {
  isDemoMode: boolean;
}

const DemoDataContext = createContext<DemoDataContextType>({
  isDemoMode: false,
});

export function DemoDataProvider({ children }: { children: ReactNode }) {
  return (
    <DemoDataContext.Provider value={{ isDemoMode: false }}>
      {children}
    </DemoDataContext.Provider>
  );
}

export function useDemoData() {
  return useContext(DemoDataContext);
}
