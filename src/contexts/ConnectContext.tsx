import React from "react";
import { connectClients } from "../api/connect/client";

type ConnectContextValue = typeof connectClients;

const ConnectContext = React.createContext<ConnectContextValue | undefined>(undefined);

export const ConnectProvider: React.FC<React.PropsWithChildren> = ({ children }) => (
  <ConnectContext.Provider value={connectClients}>{children}</ConnectContext.Provider>
);

export const useConnect = () => {
  const context = React.useContext(ConnectContext);
  if (!context) throw new Error("useConnect must be used within ConnectProvider");
  return context;
};
