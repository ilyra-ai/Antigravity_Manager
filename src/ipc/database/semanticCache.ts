import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { getCloudAccountsDbPath } from '../../utils/paths';
import { logger } from '../../utils/logger';

export interface CacheEntry {
  id: string;
  prompt_hash: string;
  prompt_text: string;
  embedding: Float32Array;
  response: string;
  model: string;
  created_at: number;
}

function getDb(): Database.Database {
  const dbPath = getCloudAccountsDbPath();
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  
  // Initialize Semantic Cache Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS semantic_cache (
      id TEXT PRIMARY KEY,
      prompt_hash TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      embedding_blob BLOB NOT NULL,
      response_text TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cache_hash ON semantic_cache(prompt_hash);
  `);
  
  return db;
}

export class SemanticCacheRepo {
  /**
   * Generates a deterministic hash for O(1) prompt matching.
   */
  static generateHash(text: string): string {
    return crypto.createHash('sha256').update(text.trim()).digest('hex');
  }

  /**
   * Stores a new semantic entry.
   */
  static async save(entry: Omit<CacheEntry, 'id' | 'created_at' | 'prompt_hash'>): Promise<void> {
    const db = getDb();
    try {
      const id = uuidv4();
      const hash = this.generateHash(entry.prompt_text);
      const createdAt = Math.floor(Date.now() / 1000);
      const embeddingBuffer = Buffer.from(entry.embedding.buffer);

      const stmt = db.prepare(`
        INSERT OR REPLACE INTO semantic_cache (
          id, prompt_hash, prompt_text, embedding_blob, response_text, model, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(id, hash, entry.prompt_text, embeddingBuffer, entry.response, entry.model, createdAt);
      logger.info(`[SemanticCache] Entry saved for hash: ${hash.substring(0, 8)}`);
    } catch (e) {
      logger.error('[SemanticCache] Failed to save entry', e);
    } finally {
      db.close();
    }
  }

  /**
   * Performs an exact match lookup.
   */
  static findExact(prompt: string): string | null {
    const db = getDb();
    try {
      const hash = this.generateHash(prompt);
      const row = db.prepare('SELECT response_text FROM semantic_cache WHERE prompt_hash = ?')
        .get(hash) as { response_text: string } | undefined;
      
      return row ? row.response_text : null;
    } finally {
      db.close();
    }
  }

  /**
   * Performs a vector similarity search.
   * PhD Level Implementation: Cosine Similarity over Float32 components.
   */
  static findSemantic(queryEmbedding: Float32Array, threshold = 0.97): string | null {
    const db = getDb();
    try {
      const rows = db.prepare('SELECT response_text, embedding_blob FROM semantic_cache').all() as any[];
      
      for (const row of rows) {
        const cachedVector = new Float32Array(
          row.embedding_blob.buffer,
          row.embedding_blob.byteOffset,
          row.embedding_blob.byteLength / 4
        );
        
        const similarity = this.cosineSimilarity(queryEmbedding, cachedVector);
        if (similarity >= threshold) {
          logger.info(`[SemanticCache] Semantic hit detected (sim: ${similarity.toFixed(4)})`);
          return row.response_text;
        }
      }
      return null;
    } finally {
      db.close();
    }
  }

  /**
   * Optimized Dot Product for normalized vectors.
   */
  private static cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;
    let dotProduct = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
    }
    return dotProduct; // Assumes normalized embeddings from Gemini API
  }
}
