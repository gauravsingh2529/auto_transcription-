// Data-access layer: the only module that knows SQL. All values are parameterised.

const COLUMNS = `
  id,
  title,
  text,
  language,
  source,
  duration_ms AS "durationMs",
  created_at  AS "createdAt",
  updated_at  AS "updatedAt"`;

// Whitelist of API field -> column for partial updates (prevents column injection).
const UPDATABLE = { title: 'title', text: 'text', language: 'language' };

/** Escapes LIKE wildcards so user search text is matched literally. */
export const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function createTranscriptionRepository(db) {
  return {
    async create({ title, text, language = null, source, durationMs = null }) {
      const { rows } = await db.query(
        `INSERT INTO transcriptions (title, text, language, source, duration_ms)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${COLUMNS}`,
        [title, text, language, source, durationMs],
      );
      return rows[0];
    },

    async findById(id) {
      const { rows } = await db.query(`SELECT ${COLUMNS} FROM transcriptions WHERE id = $1`, [id]);
      return rows[0] ?? null;
    },

    async list({ q, source, limit, offset }) {
      const where = [];
      const params = [];
      if (q) {
        params.push(`%${escapeLike(q)}%`);
        where.push(`(title ILIKE $${params.length} OR text ILIKE $${params.length})`);
      }
      if (source) {
        params.push(source);
        where.push(`source = $${params.length}`);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const [items, count] = await Promise.all([
        db.query(
          `SELECT ${COLUMNS} FROM transcriptions ${whereSql}
           ORDER BY created_at DESC, id DESC
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset],
        ),
        db.query(`SELECT COUNT(*)::int AS total FROM transcriptions ${whereSql}`, params),
      ]);
      return { items: items.rows, total: count.rows[0].total };
    },

    async update(id, patch) {
      const sets = [];
      const params = [];
      for (const [field, column] of Object.entries(UPDATABLE)) {
        if (patch[field] !== undefined) {
          params.push(patch[field]);
          sets.push(`${column} = $${params.length}`);
        }
      }
      if (sets.length === 0) return this.findById(id);

      params.push(id);
      const { rows } = await db.query(
        `UPDATE transcriptions SET ${sets.join(', ')}
         WHERE id = $${params.length}
         RETURNING ${COLUMNS}`,
        params,
      );
      return rows[0] ?? null;
    },

    async remove(id) {
      const { rowCount } = await db.query('DELETE FROM transcriptions WHERE id = $1', [id]);
      return rowCount > 0;
    },

    async ping() {
      await db.query('SELECT 1');
    },
  };
}
