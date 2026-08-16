import React, { createContext, type ReactNode, useContext } from 'react';

const MediaActivityContext = createContext(true);

type MediaActivityProviderProps = {
  active: boolean;
  children: ReactNode;
};

export function MediaActivityProvider({
  active,
  children,
}: MediaActivityProviderProps) {
  return (
    <MediaActivityContext.Provider value={active}>
      {children}
    </MediaActivityContext.Provider>
  );
}

export function useMediaActivity() {
  return useContext(MediaActivityContext);
}
