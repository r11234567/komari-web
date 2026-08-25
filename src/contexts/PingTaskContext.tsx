import React from "react";
import { listPingTasks } from "@/api/connect/ping";

export interface PingTask {
  clients?: string[];
  default_on?: boolean;
  id?: number;
  interval?: number;
  target?: string;
  type?: string;
  [property: string]: any;
}

interface PingTaskContextType {
  pingTasks: PingTask[] | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

const PingTaskContext = React.createContext<PingTaskContextType | undefined>(
  undefined
);

export const PingTaskProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [pingTasks, setPingTasks] = React.useState<PingTask[] | null>(null);
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = () => {
    setError(null);
    listPingTasks()
      .then((tasks) => {
        setPingTasks(tasks);
      })
      .catch((err) => {
        setError(err.message || "An error occurred while fetching ping tasks");
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  React.useEffect(() => {
    setIsLoading(true);

    refresh();
    setIsLoading(false);
  }, []);

  return (
    <PingTaskContext.Provider value={{ pingTasks, isLoading, error, refresh }}>
      {children}
    </PingTaskContext.Provider>
  );
};

export const usePingTask = () => {
  const context = React.useContext(PingTaskContext);
  if (!context) {
    throw new Error("usePingTask must be used within a PingTaskProvider");
  }
  return context;
};
