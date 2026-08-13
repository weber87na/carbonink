#!/usr/bin/env node
/**
 * Load a real-company demo pack into a CarbonInk sqlite database.
 *
 * The packs in src/main/data/demo/ are built from published sustainability
 * reports — every activity row carries the page it came from and whether the
 * number is disclosed verbatim, derived by unit conversion, or modeled on a
 * stated assumption. See src/main/data/demo/README.md.
 *
 * Usage:
 *   node scripts/seed-demo-company.mjs --list
 *   node scripts/seed-demo-company.mjs --pack catl-fy2025
 *   node scripts/seed-demo-company.mjs --pack hsbc-fy2025 --db /tmp/demo.sqlite --init
 *   node scripts/seed-demo-company.mjs --pack sf-holding-fy2025 --dry-run
 *
 * Flags:
 *   --pack <id>    pack to load (see --list)
 *   --db <path>    target sqlite (default: the macOS app database)
 *   --init         create + migrate the database if it does not exist.
 *                  Required for scratch databases; refuses to touch an
 *                  existing file's schema.
 *   --adopt-org    reuse an existing organization row whose name differs from
 *                  the pack's. Without it the script stops rather than
 *                  relabel a database you may care about.
 *   --dry-run      compute and report, write nothing.
 *
 * Idempotent: re-running finds existing sites, periods, sources and activity
 * rows by natural key and skips them.
 *
 * The script never deletes. `organization` is a hard singleton (UNIQUE
 * singleton_key), so a database that already holds a different company cannot
 * take a second one — point --db at a scratch file instead.
 *
 * ABI note: this runs on plain node, so better-sqlite3 must be built for the
 * node ABI. After `pnpm build` / electron-rebuild it is built for Electron and
 * this script fails with NODE_MODULE_VERSION mismatch. Fix:
 *   pnpm --filter carbonink run rebuild:node
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import Database from 'better-sqlite3';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK_DIR = join(HERE, '..', 'src', 'main', 'data', 'demo');
const MIGRATION_DIR = join(HERE, '..', 'src', 'main', 'db', 'migrations');

const { values } = parseArgs({
  options: {
    pack: { type: 'string' },
    db: { type: 'string' },
    init: { type: 'boolean', default: false },
    'adopt-org': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    list: { type: 'boolean', default: false },
  },
});

const DRY = values['dry-run'];

// ---------------------------------------------------------------------------
// Pack discovery
// ---------------------------------------------------------------------------
function loadPacks() {
  return readdirSync(PACK_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => JSON.parse(readFileSync(join(PACK_DIR, f), 'utf8')));
}

if (values.list) {
  console.log('\nAvailable demo packs:\n');
  for (const p of loadPacks()) {
    const years = p.reporting_periods.map((r) => r.year).join(', ');
    console.log(`  ${p.pack_id}`);
    console.log(`    ${p.label.en}  ·  ${p.archetype}`);
    console.log(
      `    ${p.sites.length} sites · ${p.emission_sources.length} sources · ${p.activities.length} activities · FY ${years}`,
    );
    console.log(`    source: ${p.sources[0].publisher} — ${p.sources[0].title}`);
    console.log('');
  }
  process.exit(0);
}

if (!values.pack) {
  console.error('✗ --pack is required. Run with --list to see the available packs.');
  process.exit(1);
}

const pack = loadPacks().find((p) => p.pack_id === values.pack);
if (!pack) {
  console.error(`✗ Unknown pack: ${values.pack}. Run with --list.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
const DB_PATH =
  values.db ?? join(homedir(), 'Library', 'Application Support', 'CarbonInk', 'app.sqlite');

const dbExisted = existsSync(DB_PATH);
if (!dbExisted && !values.init) {
  console.error(`✗ DB not found: ${DB_PATH}`);
  console.error('  Launch the app once (pnpm dev) so onboarding creates it, or pass --init');
  console.error('  together with --db to build a standalone scratch database.');
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

/**
 * Mirrors src/main/db/migrate.ts. That module reaches for `import.meta.glob`,
 * which only exists under vite, so a plain node script has to read the same
 * .sql files off disk itself. Kept deliberately close to the original,
 * including the foreign_keys toggle around each migration.
 */
function runMigrations() {
  const migrations = readdirSync(MIGRATION_DIR)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort()
    .map((f) => ({
      version: Number.parseInt(f.slice(0, 3), 10),
      name: f.replace(/\.sql$/, ''),
      sql: readFileSync(join(MIGRATION_DIR, f), 'utf8'),
    }));

  const hasMeta = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
    .get();
  if (!hasMeta) {
    const bootstrap = migrations.find((m) => m.version === 0);
    db.exec(bootstrap.sql);
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
      0,
      '000_meta',
      new Date().toISOString(),
    );
  }
  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((r) => r.version),
  );
  let n = 0;
  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(m.sql);
        db.prepare(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        ).run(m.version, m.name, new Date().toISOString());
      })();
    } finally {
      db.pragma('foreign_keys = ON');
    }
    n++;
  }
  if (n > 0) console.log(`  + applied ${n} migration(s)`);
}

if (values.init) runMigrations();

// ---------------------------------------------------------------------------
// Unit conversion — mirrors src/main/services/unit-conversion-service.ts
// ---------------------------------------------------------------------------
const unitDef = db.prepare(
  'SELECT unit, family, multiply_of_ratio, divide_of_ratio FROM unit_definition WHERE unit = ?',
);
const unitAlias = db.prepare(
  `SELECT u.unit, u.family, u.multiply_of_ratio, u.divide_of_ratio
     FROM unit_alias a JOIN unit_definition u ON u.unit = a.canonical_unit
    WHERE a.alias = ?`,
);
const fuelProp = db.prepare(
  `SELECT fuel_code, density_kg_per_L, density_kg_per_m3,
          lower_heating_value_MJ_per_kg, lower_heating_value_MJ_per_m3
     FROM fuel_property WHERE fuel_code = ?`,
);

function normalize(unit) {
  const direct = unitDef.get(unit);
  if (direct) return direct;
  const via = unitAlias.get(unit);
  if (via) return via;
  throw new Error(`Unknown unit: ${unit}`);
}

function convert(amount, fromUnit, toUnit) {
  const from = normalize(fromUnit);
  const to = normalize(toUnit);
  if (from.family !== to.family) {
    throw new Error(
      `Cannot convert ${fromUnit} (${from.family}) to ${toUnit} (${to.family}) without a fuel_code`,
    );
  }
  const canonical = (amount * from.multiply_of_ratio) / from.divide_of_ratio;
  return (canonical * to.divide_of_ratio) / to.multiply_of_ratio;
}

function convertWithFuel(amount, fromUnit, toUnit, fuelCode) {
  const fuel = fuelProp.get(fuelCode);
  if (!fuel) throw new Error(`Unknown fuel_code: ${fuelCode}`);
  const from = normalize(fromUnit);
  const to = normalize(toUnit);
  if (from.family === to.family) return convert(amount, fromUnit, toUnit);

  let kg;
  let mj;
  if (from.family === 'volume') {
    const l = convert(amount, fromUnit, 'L');
    if (fuel.density_kg_per_L != null) kg = l * fuel.density_kg_per_L;
    else if (fuel.density_kg_per_m3 != null) kg = (l / 1000) * fuel.density_kg_per_m3;
    if (fuel.lower_heating_value_MJ_per_m3 != null)
      mj = (l / 1000) * fuel.lower_heating_value_MJ_per_m3;
    else if (kg != null && fuel.lower_heating_value_MJ_per_kg != null)
      mj = kg * fuel.lower_heating_value_MJ_per_kg;
  } else if (from.family === 'mass') {
    kg = convert(amount, fromUnit, 'kg');
    if (fuel.lower_heating_value_MJ_per_kg != null) mj = kg * fuel.lower_heating_value_MJ_per_kg;
  } else if (from.family === 'energy') {
    mj = convert(amount, fromUnit, 'MJ');
    if (fuel.lower_heating_value_MJ_per_kg != null) kg = mj / fuel.lower_heating_value_MJ_per_kg;
  }

  if (to.family === 'mass') {
    if (kg == null) throw new Error(`Cannot derive mass from ${fromUnit} via fuel ${fuelCode}`);
    return convert(kg, 'kg', toUnit);
  }
  if (to.family === 'volume') {
    if (kg == null || fuel.density_kg_per_L == null) {
      throw new Error(`Cannot derive volume from ${fromUnit} via fuel ${fuelCode}`);
    }
    return convert(kg / fuel.density_kg_per_L, 'L', toUnit);
  }
  if (to.family === 'energy') {
    if (mj == null) throw new Error(`Cannot derive energy from ${fromUnit} via fuel ${fuelCode}`);
    return convert(mj, 'MJ', toUnit);
  }
  throw new Error(`Cannot convert to family ${to.family}`);
}

// GWP100 AR6, mirroring src/main/services/calculation-service.ts.
const GWP = { CH4: 27.9, N2O: 273 };

function computeCo2eKg(amount, unit, ef, fuelCode) {
  const inEfUnit =
    fuelCode != null
      ? convertWithFuel(amount, unit, ef.input_unit, fuelCode)
      : convert(amount, unit, ef.input_unit);
  const direct = inEfUnit * ef.co2e_kg_per_unit;
  const ch4 = ef.ch4_kg_per_unit != null ? inEfUnit * ef.ch4_kg_per_unit * GWP.CH4 : 0;
  const n2o = ef.n2o_kg_per_unit != null ? inEfUnit * ef.n2o_kg_per_unit * GWP.N2O : 0;
  return { co2e_kg: direct + ch4 + n2o, inEfUnit };
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
const now = new Date().toISOString();
console.log(`\n${pack.label.en}`);
console.log(`  pack   ${pack.pack_id}`);
console.log(`  db     ${DB_PATH}${DRY ? '  (dry run — nothing will be written)' : ''}`);
console.log(`  source ${pack.sources[0].publisher}`);
console.log(
  pack.fictional
    ? '         every figure in this pack is invented — see notes[]\n'
    : `         ${pack.sources[0].url}\n`,
);

// Organization (hard singleton).
let org = db.prepare('SELECT id, name_zh, name_en FROM organization LIMIT 1').get();
const wantName = pack.organization.name_en ?? pack.organization.name_zh;
if (!org) {
  const id = randomUUID();
  if (!DRY) {
    db.prepare(
      `INSERT INTO organization
         (id, singleton_key, name_zh, name_en, industry, country_code, boundary_kind,
          responsible_person_name, responsible_person_role, base_year_period_id,
          recalc_threshold_pct, created_at, updated_at)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    ).run(
      id,
      pack.organization.name_zh,
      pack.organization.name_en,
      pack.organization.industry,
      pack.organization.country_code,
      pack.organization.boundary_kind,
      pack.organization.responsible_person_name,
      pack.organization.responsible_person_role,
      pack.organization.recalc_threshold_pct,
      now,
      now,
    );
  }
  org = { id, name_en: pack.organization.name_en };
  console.log(`  + organization ${wantName}`);
} else {
  const haveName = org.name_en ?? org.name_zh;
  const matches = haveName === pack.organization.name_en || haveName === pack.organization.name_zh;
  if (!matches && !values['adopt-org']) {
    console.error(`\n✗ This database already holds a different organization: "${haveName}".`);
    console.error('  organization is a singleton, so the pack cannot add a second one.');
    console.error('  Either point --db at a scratch file:');
    console.error(
      `    node scripts/seed-demo-company.mjs --pack ${pack.pack_id} --db /tmp/demo.sqlite --init`,
    );
    console.error('  or pass --adopt-org to attach this pack to the existing organization.');
    process.exit(1);
  }
  console.log(`  ✓ organization ${haveName}${matches ? '' : ' (adopted)'}`);
}

// Sites.
const siteIds = {};
const findSite = db.prepare(
  'SELECT id FROM site WHERE organization_id = ? AND (name_en = ? OR name_zh = ?)',
);
const insertSite = db.prepare(
  `INSERT INTO site (id, organization_id, name_zh, name_en, address, country_code, is_active, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
);
let newSites = 0;
for (const s of pack.sites) {
  const found = findSite.get(org.id, s.name_en ?? null, s.name_zh ?? null);
  if (found) {
    siteIds[s.key] = found.id;
    continue;
  }
  const id = randomUUID();
  if (!DRY) {
    insertSite.run(
      id,
      org.id,
      s.name_zh ?? null,
      s.name_en ?? null,
      s.address ?? null,
      s.country_code,
      now,
      now,
    );
  }
  siteIds[s.key] = id;
  newSites++;
}
console.log(`  + ${newSites} site(s), ${pack.sites.length - newSites} already present`);

// Reporting periods.
const periodIds = {};
const findPeriod = db.prepare(
  'SELECT id FROM reporting_period WHERE organization_id = ? AND year = ? AND granularity = ?',
);
const insertPeriod = db.prepare(
  `INSERT INTO reporting_period (id, organization_id, year, granularity, starts_at, ends_at, is_active, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);
let newPeriods = 0;
for (const p of pack.reporting_periods) {
  const found = findPeriod.get(org.id, p.year, p.granularity);
  if (found) {
    periodIds[p.key] = found.id;
    continue;
  }
  const id = randomUUID();
  if (!DRY) {
    insertPeriod.run(id, org.id, p.year, p.granularity, p.starts_at, p.ends_at, p.is_active, now);
  }
  periodIds[p.key] = id;
  newPeriods++;
}
console.log(
  `  + ${newPeriods} reporting period(s), ${pack.reporting_periods.length - newPeriods} already present`,
);

// Emission sources.
const sourceIds = {};
const findSource = db.prepare('SELECT id FROM emission_source WHERE site_id = ? AND name = ?');
const insertSource = db.prepare(
  `INSERT INTO emission_source (id, site_id, name, scope, category, ghg_protocol_path, default_ef_query, template_origin, is_active)
   VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 1)`,
);
let newSources = 0;
for (const s of pack.emission_sources) {
  const siteId = siteIds[s.site];
  if (!siteId) throw new Error(`Pack references unknown site key: ${s.site}`);
  const found = DRY ? null : findSource.get(siteId, s.name);
  if (found) {
    sourceIds[s.key] = found.id;
    continue;
  }
  const id = randomUUID();
  if (!DRY) {
    insertSource.run(
      id,
      siteId,
      s.name,
      s.scope,
      s.category,
      s.ghg_protocol_path,
      `demo:${pack.pack_id}`,
    );
  }
  sourceIds[s.key] = id;
  newSources++;
}
console.log(
  `  + ${newSources} emission source(s), ${pack.emission_sources.length - newSources} already present`,
);

// Emission factors: resolve factor_code -> the full composite PK, then pin.
const efByCode = db.prepare('SELECT * FROM emission_factor WHERE factor_code = ?');
const efAllByCode = db.prepare('SELECT COUNT(*) AS n FROM emission_factor WHERE factor_code = ?');
const pinExists = db.prepare(
  `SELECT 1 FROM pinned_emission_factor
    WHERE factor_code = ? AND year = ? AND source = ? AND geography = ? AND dataset_version = ?`,
);
const pinInsert = db.prepare(`
  INSERT INTO pinned_emission_factor (
    factor_code, year, source, geography, dataset_version,
    scope, category, ghg_protocol_path, input_unit, co2e_kg_per_unit,
    ch4_kg_per_unit, n2o_kg_per_unit, hfc_kg_per_unit, pfc_kg_per_unit,
    sf6_kg_per_unit, nf3_kg_per_unit, gwp_basis,
    name_zh, name_en, description_zh, description_en, citation_url,
    pinned_at, pinned_from
  )
  SELECT
    factor_code, year, source, geography, dataset_version,
    scope, category, ghg_protocol_path, input_unit, co2e_kg_per_unit,
    ch4_kg_per_unit, n2o_kg_per_unit, hfc_kg_per_unit, pfc_kg_per_unit,
    sf6_kg_per_unit, nf3_kg_per_unit, gwp_basis,
    name_zh, name_en, description_zh, description_en, citation_url,
    ?, 'demo-pack'
  FROM emission_factor
   WHERE factor_code = ? AND year = ? AND source = ? AND geography = ? AND dataset_version = ?
`);

const efCache = new Map();
function resolveEf(code) {
  if (efCache.has(code)) return efCache.get(code);
  const count = efAllByCode.get(code).n;
  if (count === 0) throw new Error(`EF not in library: ${code}`);
  if (count > 1) {
    throw new Error(
      `EF code ${code} is ambiguous (${count} rows) — the pack must name the full composite key`,
    );
  }
  const ef = efByCode.get(code);
  if (
    !DRY &&
    !pinExists.get(ef.factor_code, ef.year, ef.source, ef.geography, ef.dataset_version)
  ) {
    pinInsert.run(now, ef.factor_code, ef.year, ef.source, ef.geography, ef.dataset_version);
  }
  efCache.set(code, ef);
  return ef;
}

// Activities.
const activityExists = db.prepare(
  `SELECT 1 FROM activity_data
    WHERE emission_source_id = ? AND reporting_period_id = ? AND occurred_at_start = ? AND occurred_at_end = ?`,
);
const insertActivity = db.prepare(
  `INSERT INTO activity_data
     (id, site_id, emission_source_id, reporting_period_id,
      occurred_at_start, occurred_at_end, amount, unit,
      ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
      computed_co2e_kg, computed_at, extraction_id, notes, fuel_code, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
);

const tally = {}; // period -> scope -> kg
let inserted = 0;
let skipped = 0;
for (const a of pack.activities) {
  const sourceDef = pack.emission_sources.find((s) => s.key === a.source);
  if (!sourceDef) throw new Error(`Activity references unknown source key: ${a.source}`);
  const sourceId = sourceIds[a.source];
  const periodId = periodIds[a.period];
  const siteId = siteIds[sourceDef.site];
  const ef = resolveEf(a.ef);

  const { co2e_kg } = computeCo2eKg(a.amount, a.unit, ef, a.fuel_code ?? undefined);

  tally[a.period] ??= {};
  tally[a.period][sourceDef.scope] = (tally[a.period][sourceDef.scope] ?? 0) + co2e_kg;

  if (!DRY && activityExists.get(sourceId, periodId, a.occurred_at_start, a.occurred_at_end)) {
    skipped++;
    continue;
  }
  const note = `${a.provenance.kind} · ${a.provenance.source_ref} · ${a.provenance.locator}`;
  if (!DRY) {
    insertActivity.run(
      randomUUID(),
      siteId,
      sourceId,
      periodId,
      a.occurred_at_start,
      a.occurred_at_end,
      a.amount,
      a.unit,
      ef.factor_code,
      ef.year,
      ef.source,
      ef.geography,
      ef.dataset_version,
      Math.round(co2e_kg * 100) / 100,
      now,
      note,
      a.fuel_code ?? null,
      now,
      now,
    );
  }
  inserted++;
}
console.log(`  + ${inserted} activity row(s)${skipped ? `, ${skipped} already present` : ''}`);

// ---------------------------------------------------------------------------
// Reconciliation against what the company actually published
// ---------------------------------------------------------------------------
const fmtT = (v) => (v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 0 }));

// A fictional pack has nothing to reconcile against, so show the computed
// totals on their own instead of an empty comparison table.
if (pack.fictional) {
  console.log(
    '\n  Computed totals (tCO2e) — nothing to reconcile against, the figures are invented',
  );
  console.log('  ' + '-'.repeat(78));
  for (const p of pack.reporting_periods) {
    const got = tally[p.key] ?? {};
    const parts = [1, 2, 3]
      .filter((s) => got[s] != null)
      .map((s) => `Scope ${s} ${fmtT(got[s] / 1000).padStart(6)}`);
    const total = [1, 2, 3].reduce((sum, s) => sum + (got[s] ?? 0), 0);
    console.log(`    ${p.key} (${p.year})   ${parts.join('   ')}   total ${fmtT(total / 1000)}`);
  }
} else {
  console.log('\n  Computed vs disclosed (tCO2e)');
  console.log('  ' + '-'.repeat(78));
}

for (const p of pack.reporting_periods) {
  const disclosed = pack.disclosed_totals.find((d) => d.period === p.key);
  if (!disclosed) continue;
  const got = tally[p.key] ?? {};

  // Every activity row here computes a location-based Scope 2, so only a
  // location-based disclosure is a like-for-like comparison. Comparing against
  // a market-based figure would silently score renewable procurement as
  // calculation error, which is exactly the mistake this tool exists to prevent.
  const s2Disclosed = disclosed.scope2_location_tco2e ?? disclosed.scope2_tco2e ?? null;
  const s2Basis =
    disclosed.scope2_location_tco2e != null
      ? 'location'
      : disclosed.scope2_tco2e != null
        ? 'as-published'
        : null;

  const rows = [
    ['Scope 1', got[1], disclosed.scope1_tco2e, null],
    ['Scope 2', got[2], s2Disclosed, s2Basis],
    ['Scope 3', got[3], disclosed.scope3_tco2e, null],
  ];
  console.log(`  ${p.key} (${p.year})`);
  for (const [label, kg, discT, basis] of rows) {
    if (kg == null && discT == null) continue;
    const computedT = kg != null ? kg / 1000 : null;
    const pct =
      computedT != null && discT ? `${(((computedT - discT) / discT) * 100).toFixed(1)}%` : '—';
    const tag = basis ? ` (${basis})` : '';
    console.log(
      `    ${label}  computed ${fmtT(computedT).padStart(12)}   disclosed ${fmtT(discT).padStart(12)}${tag}   ${pct.padStart(8)}`,
    );
  }
  if (s2Disclosed == null && disclosed.scope2_market_tco2e != null) {
    console.log(
      `      note: only a market-based Scope 2 is published for this year (${fmtT(disclosed.scope2_market_tco2e)} tCO2e).` +
        ' Not comparable to the location-based figure computed above.',
    );
  }
  // Packs whose Scope 3 is disclosed per category rather than as a total.
  if (disclosed.scope3_tco2e == null && disclosed.scope3_by_category_tco2e) {
    const cats = disclosed.scope3_by_category_tco2e;
    const modeled = new Set(
      pack.emission_sources
        .filter((s) => s.scope === 3)
        .map((s) => (s.ghg_protocol_path ?? '').match(/cat(\d+)_/)?.[1])
        .filter(Boolean),
    );
    for (const c of modeled) {
      if (cats[c] == null) continue;
      const computedT = got[3] != null ? got[3] / 1000 : null;
      const pct =
        computedT != null ? `${(((computedT - cats[c]) / cats[c]) * 100).toFixed(1)}%` : '—';
      console.log(
        `      Scope 3 cat ${c}  computed ${fmtT(computedT).padStart(10)}   disclosed ${fmtT(cats[c]).padStart(10)}   ${pct.padStart(8)}`,
      );
    }
  }
}
if (pack.expected_reconciliation?.length) {
  console.log('\n  Why the gaps are what they are:');
  for (const r of pack.expected_reconciliation) {
    console.log(`    · [${r.period} scope ${r.scope}] ${r.why}`);
  }
}
if (pack.gaps?.length) {
  console.log('\n  Disclosed but not loaded:');
  for (const g of pack.gaps) console.log(`    · ${g.item} — ${g.reason.split('.')[0]}.`);
}

console.log(
  DRY
    ? '\n✓ Dry run complete. Nothing was written.\n'
    : '\n✓ Seed complete. Restart or refresh the app to see the data.\n',
);
