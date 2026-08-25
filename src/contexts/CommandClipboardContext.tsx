import React from "react";
import {
  createClipboardEntry,
  deleteClipboardEntries,
  listClipboardEntries,
  updateClipboardEntry,
  type ClipboardEntry,
} from "@/api/connect/maintenance";

export type CommandClipboard = ClipboardEntry;

interface CommandClipboardContextType {
  commands: CommandClipboard[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  addCommand: (name: string, text: string, remark: string, weight: number) => Promise<void>;
  updateCommand: (id: number, name: string, text: string, remark: string, weight: number) => Promise<void>;
  deleteCommand: (id:number) => Promise<void>;
}

const CommandClipboardContext = React.createContext<
  CommandClipboardContextType | undefined
>(undefined);

export const CommandClipboardProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<Error | null>(null);
  const [commands, setCommands] = React.useState<CommandClipboard[]>([]);
  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setCommands(await listClipboardEntries());
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  };
  const addCommand = async (name: string, text: string, remark: string, weight: number) => {
    try {
      await createClipboardEntry({ name, text, remark, weight });
      refresh();
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  };

  const updateCommand = async (
    id: number,
    name: string,
    text: string,
    remark: string,
    weight: number
  ) => {
    try {
      await updateClipboardEntry({ id, name, text, remark, weight });
      refresh();
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  };

  const deleteCommand = async (id: number) => {
    try {
      await deleteClipboardEntries([id]);
      refresh();
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    refresh();
  }, []);
  return (
    <CommandClipboardContext.Provider
      value={{
        commands,
        loading,
        error,
        refresh,
        addCommand,
        updateCommand,
        deleteCommand,
      }}
    >
      {children}
    </CommandClipboardContext.Provider>
  );
};

export const useCommandClipboard = (): CommandClipboardContextType => {
  const context = React.useContext(CommandClipboardContext);
  if (!context) {
    throw new Error(
      "useCommandClipboard must be used within a CommandClipboardProvider"
    );
  }
  return context;
};
