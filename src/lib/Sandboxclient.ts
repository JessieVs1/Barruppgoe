// ---------- Testfase: nep-database in het geheugen ----------
// Tijdens de testfase praat de app niet met Supabase maar met deze
// "sandbox". Bij het starten wordt de echte data ALLEEN GELEZEN (select) en
// gekopieerd naar het geheugen van de browser. Alle wijzigingen (bestellen,
// voorraad, gebruikers, tikkies, ...) gebeuren op die kopie en verdwijnen
// zodra de testfase stopt of de pagina wordt herladen. Er wordt nooit iets
// naar de echte database geschreven.

type Row = Record<string, any>;
type Store = Record<string, Row[]>;

const T = {
  users: 'users_2025_10_08_21_03',
  products: 'products_2025_10_08_21_03',
  orders: 'orders_2025_10_08_21_03',
  missing: 'missing_items_2025_10_08_21_03',
  revenue: 'monthly_revenue_2025_10_09_18_50',
  settings: 'app_settings_2025_10_08_21_03',
  adminCodes: 'admin_codes_2025_10_08_21_03',
  settlements: 'settlements_2025_10_08_21_03',
  settlementItems: 'settlement_items_2025_10_08_21_03',
};

const ALL_TABLES = Object.values(T);

// Kolommen die uniek moeten zijn (zoals in de echte database).
const UNIQUE: Record<string, string[]> = {
  [T.users]: ['code'],
  [T.adminCodes]: ['code'],
  [T.revenue]: ['year', 'month'],
};

const ALL_PERMISSIONS = ['users', 'products', 'orders', 'revenue', 'missing', 'settlements', 'settings'];

const clone = <X>(v: X): X => JSON.parse(JSON.stringify(v));

/** Leest (alleen lezen!) alle tabellen uit de echte database. */
export async function loadSandboxStore(real: any): Promise<Store> {
  const store: Store = {};
  const results = await Promise.all(
    ALL_TABLES.map(async (table) => {
      try {
        const { data, error } = await real.from(table).select('*');
        return error || !data ? [] : data;
      } catch {
        return [];
      }
    })
  );
  ALL_TABLES.forEach((table, i) => {
    store[table] = clone(results[i]);
  });
  return store;
}

const makeError = (message: string, code?: string) => ({ message, code, details: null, hint: null });

function applyDefaults(table: string, row: Row): Row {
  const out: Row = { ...row };
  if (out.created_at === undefined && table !== T.settings) out.created_at = new Date().toISOString();
  switch (table) {
    case T.users:
      if (out.status === undefined) out.status = 'approved';
      break;
    case T.products:
      if (out.description === undefined) out.description = '';
      if (out.stock === undefined) out.stock = 0;
      break;
    case T.orders:
      if (out.settlement_id === undefined) out.settlement_id = null;
      break;
    case T.revenue:
      if (out.revenue === undefined) out.revenue = 0;
      if (out.is_locked === undefined) out.is_locked = false;
      out.updated_at = out.updated_at ?? new Date().toISOString();
      break;
    case T.adminCodes:
      if (out.permissions === undefined) out.permissions = [...ALL_PERMISSIONS];
      break;
    case T.settlementItems:
      if (out.paid === undefined) out.paid = false;
      if (out.paid_at === undefined) out.paid_at = null;
      break;
    default:
      break;
  }
  return out;
}

class SandboxQuery implements PromiseLike<any> {
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private payload: any = null;
  private columns: string | undefined = '*';
  private returning = false;
  private filters: Array<(r: Row) => boolean> = [];
  private sorts: Array<{ col: string; asc: boolean }> = [];
  private mode: 'many' | 'single' | 'maybe' = 'many';

  constructor(private store: Store, private table: string) {}

  select(columns = '*') {
    if (this.op === 'select') this.columns = columns;
    else this.returning = true;
    return this;
  }
  insert(payload: any) { this.op = 'insert'; this.payload = payload; return this; }
  update(payload: any) { this.op = 'update'; this.payload = payload; return this; }
  delete() { this.op = 'delete'; return this; }

  eq(col: string, val: any) { this.filters.push(r => r[col] === val); return this; }
  neq(col: string, val: any) { this.filters.push(r => r[col] !== val); return this; }
  is(col: string, val: any) { this.filters.push(r => (val === null ? r[col] === null || r[col] === undefined : r[col] === val)); return this; }
  in(col: string, vals: any[]) { this.filters.push(r => vals.includes(r[col])); return this; }
  order(col: string, opts?: { ascending?: boolean }) { this.sorts.push({ col, asc: opts?.ascending !== false }); return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }

  then<R1 = any, R2 = never>(
    onfulfilled?: ((value: any) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: any) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return Promise.resolve()
      .then(() => this.run())
      .then(onfulfilled as any, onrejected as any);
  }

  private matching(): Row[] {
    return (this.store[this.table] || []).filter(r => this.filters.every(f => f(r)));
  }

  private shape(rows: Row[]) {
    let out = rows.map(r => clone(r));
    if (this.columns && this.columns !== '*') {
      const cols = this.columns.split(',').map(c => c.trim());
      out = out.map(r => Object.fromEntries(cols.map(c => [c, r[c]])));
    }
    if (this.mode === 'single') {
      if (out.length !== 1) {
        return { data: null, error: makeError('JSON object requested, multiple (or no) rows returned', 'PGRST116') };
      }
      return { data: out[0], error: null };
    }
    if (this.mode === 'maybe') return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }

  private run(): { data: any; error: any } {
    const rows = (this.store[this.table] = this.store[this.table] || []);

    if (this.op === 'select') {
      let found = this.matching();
      for (const s of [...this.sorts].reverse()) {
        found = [...found].sort((a, b) => {
          const av = a[s.col], bv = b[s.col];
          if (av === bv) return 0;
          if (av === null || av === undefined) return 1;
          if (bv === null || bv === undefined) return -1;
          return (av < bv ? -1 : 1) * (s.asc ? 1 : -1);
        });
      }
      return this.shape(found);
    }

    if (this.op === 'insert') {
      const incoming: Row[] = Array.isArray(this.payload) ? this.payload : [this.payload];
      const created: Row[] = [];
      for (const raw of incoming) {
        const row = applyDefaults(this.table, raw);
        const uniqueCols = UNIQUE[this.table];
        if (uniqueCols) {
          const clash = rows.find(r => uniqueCols.every(c => r[c] === row[c]));
          if (clash) {
            return { data: null, error: makeError(`duplicate key value violates unique constraint on ${uniqueCols.join(', ')}`, '23505') };
          }
        }
        if (row.id === undefined && this.table !== T.settings) {
          row.id = rows.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1;
        }
        rows.push(row);
        created.push(row);
        if (this.table === T.orders) this.addToMonthlyRevenue(row);
      }
      return this.returning ? this.shape(created) : { data: null, error: null };
    }

    if (this.op === 'update') {
      const found = this.matching();
      found.forEach(r => Object.assign(r, clone(this.payload)));
      return this.returning ? this.shape(found) : { data: null, error: null };
    }

    // delete
    const toRemove = new Set(this.matching());
    this.store[this.table] = rows.filter(r => !toRemove.has(r));
    return { data: null, error: null };
  }

  // Zelfde gedrag als de database-trigger: een nieuwe bestelling telt mee in de maandomzet.
  private addToMonthlyRevenue(order: Row) {
    const d = new Date(order.created_at);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const amount = Number(order.price) * Number(order.quantity);
    const rev = (this.store[T.revenue] = this.store[T.revenue] || []);
    const existing = rev.find(r => r.year === year && r.month === month);
    if (existing) {
      existing.revenue = Number(existing.revenue) + amount;
      existing.updated_at = new Date().toISOString();
    } else {
      rev.push(applyDefaults(T.revenue, {
        id: rev.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1,
        year, month, revenue: amount,
      }));
    }
  }
}

/** Maakt een client met dezelfde from()/rpc()-vorm als supabase-js, maar volledig in het geheugen. */
export function createSandboxClient(store: Store) {
  return {
    from: (table: string) => new SandboxQuery(store, table),
    rpc: async (fn: string, args?: Record<string, any>) => {
      if (fn !== 'create_settlement') {
        return { data: null, error: makeError(`Onbekende functie ${fn}`) };
      }
      const orders = store[T.orders] || [];
      const open = orders.filter(o => o.settlement_id === null || o.settlement_id === undefined);
      if (open.length === 0) {
        return { data: null, error: makeError('Geen openstaande bestellingen') };
      }
      const settlements = (store[T.settlements] = store[T.settlements] || []);
      const id = settlements.reduce((max, s) => Math.max(max, Number(s.id) || 0), 0) + 1;
      settlements.push({ id, created_at: new Date().toISOString(), due_at: args?.p_due_at });

      const totals = new Map<string, number>();
      open.forEach(o => totals.set(o.user_code, (totals.get(o.user_code) || 0) + Number(o.price) * Number(o.quantity)));
      const items = (store[T.settlementItems] = store[T.settlementItems] || []);
      let nextItemId = items.reduce((max, i) => Math.max(max, Number(i.id) || 0), 0) + 1;
      totals.forEach((amount, code) => {
        if (amount <= 0) return;
        const user = (store[T.users] || []).find(u => u.code === code);
        items.push({
          id: nextItemId++, settlement_id: id, user_code: code,
          user_name: user?.name ?? 'Onbekend', amount, paid: false, paid_at: null,
        });
      });
      open.forEach(o => { o.settlement_id = id; });
      return { data: id, error: null };
    },
  };
}
