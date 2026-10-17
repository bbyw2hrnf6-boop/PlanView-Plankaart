import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
export const aiCredentials = sqliteTable('ai_credentials', {
  userId: text('user_id').primaryKey(),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  updatedAt: integer('updated_at').notNull()
});
export const aiUsage = sqliteTable('ai_usage', {
  userId: text('user_id').primaryKey(),
  windowStart: integer('window_start').notNull(),
  requests: integer('requests').notNull(),
  busyUntil: integer('busy_until').notNull()
});

export const sourceCredentials = sqliteTable('source_credentials', {
  userId: text('user_id').notNull(), provider: text('provider').notNull(),
  ciphertext: text('ciphertext').notNull(), iv: text('iv').notNull(), updatedAt: integer('updated_at').notNull()
}, table => [primaryKey({columns:[table.userId,table.provider]})]);
