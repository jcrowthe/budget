import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const planImports = sqliteTable(
  "plan_imports",
  {
    id: text("id").primaryKey(),
    budgetId: text("budget_id").notNull(),
    state: text("state", { enum: ["writing", "done", "abandoned"] }).notNull(),
    actor: text("actor").notNull(),
    fileName: text("file_name").notNull(),
    r2Key: text("r2_key"),
    chunkCount: integer("chunk_count").notNull(),
    nextChunk: integer("next_chunk").notNull(),
    chunkOffsets: text("chunk_offsets").notNull(),
    summaryJson: text("summary_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (t) => [index("plan_imports_state_updated").on(t.state, t.updatedAt)],
);
