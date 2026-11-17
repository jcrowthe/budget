import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

type Filter = { on: boolean; setOn: (on: boolean) => void };
const Ctx = createContext<Filter>({ on: false, setOn: () => {} });

/** The View filter of the banner: state of one page only; it is never stored and ends when the page is left. */
export function AttentionFilterProvider({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(false);
  const value = useMemo(() => ({ on, setOn }), [on]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** True while the listed rows include an unapproved one: only then does the table show its attention column. */
export const AttentionColumnContext = createContext(false);
export const useAttentionColumn = () => useContext(AttentionColumnContext);

export const useAttentionFilter = () => useContext(Ctx);
