# Real-company demo packs

Four inventories built from published sustainability reports. Used for local
demos, screenshots and tests — anywhere synthetic numbers would be less
convincing or would hide a real modelling problem.

| Pack | Archetype | Years | Why it's here |
|---|---|---|---|
| `catl-fy2025` | CN battery manufacturing, 16 sites | 2024–2025 | Coal + steam carriers; Scope 1 that energy data provably cannot explain |
| `sf-holding-fy2025` | CN express logistics, 2 segments | 2023–2025 | Seven fuel carriers disclosed separately; aviation kerosene dominates |
| `microsoft-fy2025` | Global hyperscale datacenters | FY2024–FY2025 | Non-calendar FY; 11 Scope 3 categories; regional electricity |
| `hsbc-fy2025` | Global bank, office estate | 2023–2025 | Closest to an SME consulting client; travel lands as real activity rows |

```bash
node scripts/seed-demo-company.mjs --list
node scripts/seed-demo-company.mjs --pack catl-fy2025                          # into the app DB
node scripts/seed-demo-company.mjs --pack hsbc-fy2025 --db /tmp/x.sqlite --init # scratch DB
node scripts/seed-demo-company.mjs --pack sf-holding-fy2025 --dry-run
```

## The one rule

**A number in a pack is either what the company published, or it is labelled as
not being that.** Every activity row carries `provenance.kind`:

- **`disclosed`** — the published figure, in the published unit, entered
  verbatim. The app does any unit conversion in-flight (`13,688,213.61 MWh` of
  electricity, `2,352,136.22 MWh` of coal with `fuel_code: coal_anthracite`).
- **`derived`** — a deterministic unit conversion the app cannot perform
  itself, with the constants and their source in `provenance.derivation`. Only
  used where a real product gap forces it (see below).
- **`modeled`** — an analyst assumption sits on top of the number: a merged
  fuel line split one way, or a proxy emission factor from the wrong geography.
  `provenance.assumption` says what was assumed and how wrong it could be.

Every row also carries `source_ref` and a `locator` naming the table and page.
`disclosed.value` and `disclosed.unit` always hold the original figure, so a
derived or modeled row can be re-derived from scratch or corrected in place.

Anything disclosed but **not** loadable goes in `gaps[]` rather than being
quietly dropped or forced onto a wrong factor — purchased steam, refrigerant
totals with no charge quantity, Scope 3 categories published only as tCO2e.

## Reconciliation is the point

The loader prints computed vs disclosed for each period, and each pack states
in `expected_reconciliation[]` what gap to expect **and why**. Current state:

| Pack | Scope 1 | Scope 2 (location) | Note |
|---|---|---|---|
| CATL FY2025 | −32.0% | **−2.1%** | Scope 1 residual is process + fugitive emissions |
| SF FY2025 | −12.0% | −9.4% | Residual is refrigerants + undisclosed carriers |
| Microsoft FY2025 | −38.9% | +22.3% | Scope 1 is 41% HFC leakage; Scope 2 uses proxy grids |
| HSBC FY2025 | −39.2% | −10.2% | Cat 6 travel −39.5% (no RF uplift, no cabin weighting) |

CATL's −2.1% is the load-bearing one: 13.7 TWh against the MEE national grid
factor, reconciling to an audited disclosure. That single number exercises unit
conversion, EF pinning and the calculation service end to end. **If it drifts,
something in the calculation chain broke.**

The large Scope 1 gaps are correct and should not be "fixed". An inventory
built from an energy table cannot contain process emissions, fugitive gases or
refrigerant leakage, because those are not in an energy table.

## Product gaps these packs surfaced

Two conversions originally had to be pre-computed in the packs, because the app
could not do them. **Migration 022 closed both**, and those rows are now plain
`disclosed` MWh that the app converts in flight:

1. **Natural gas in MWh → m³ threw.** `fuel_property.natural_gas` carried
   `lower_heating_value_MJ_per_m3` (35.9) and `density_kg_per_m3` (0.717) but
   neither per-kg nor per-L value, and `convertWithFuel`'s energy → volume path
   needs both (it derives mass first, then divides by `density_kg_per_L`).
   Users hit `Cannot derive volume from MWh via fuel natural_gas`. Every pack
   here hit it — MWh is the standard disclosure unit for gas.
2. **No jet-kerosene fuel property.** Aviation fuel in MWh could not reach the
   litres `fuel.jet_a.combustion` expects, blocking the single largest line in
   the SF pack.

Migration 022's natural gas values are derived from that row's own m³ figures
so every conversion path agrees; see the migration header for why quoting the
IPCC per-kg default instead would have been worse. A `cng` row is the obvious
next one — the SF pack still pre-converts compressed natural gas.

Still missing from the EF library, which is why `gaps[]` exists at all:
purchased steam/heat, purchased cooling, water, waste, refrigerants, and grid
factors outside CN and US (forcing the proxies in the Microsoft and HSBC packs).

## Pack shape

```jsonc
{
  "pack_id": "...", "schema_version": 1,
  "label": { "zh": "...", "en": "..." },
  "archetype": "...",              // industry shape, for picking a demo
  "sources": [ { "ref", "publisher", "title", "url", "published_at",
                 "retrieved_at", "notes" } ],
  "organization": { /* matches src/shared/schemas/organization.ts */ },
  "sites": [ { "key", "name_zh", "name_en", "country_code",
               "carries_activity" } ],
  "reporting_periods": [ { "key", "year", "granularity",
                           "starts_at", "ends_at", "is_active" } ],
  "emission_sources": [ { "key", "site", "name", "scope", "category",
                          "ghg_protocol_path" } ],
  "activities": [ { "source", "period", "occurred_at_start", "occurred_at_end",
                    "amount", "unit", "fuel_code", "ef", "provenance" } ],
  "disclosed_totals": [ /* per period, as published */ ],
  "expected_reconciliation": [ /* what gap to expect, and why */ ],
  "gaps": [ /* disclosed but not loadable, with the reason */ ],
  "notes": [ /* what makes this pack interesting to demo */ ]
}
```

`sites[].carries_activity: false` marks a site that is real and named in the
report but carries no activity rows, because the company publishes no per-site
energy. CATL's 16 plants and HSBC's 18 countries are real; allocating group
totals across them would be invention, so we don't.

`ef` names a `factor_code` from the seeded library and must resolve to exactly
one row — the loader refuses an ambiguous code rather than guessing a vintage.

## Adding a pack

1. Find a report with **activity quantities**, not just tCO2e. Energy by
   carrier, fuel volumes, travel distances. A report with only CO2e totals
   cannot become an inventory.
2. Write the JSON. Cite table and page in every `locator`.
3. Add it to `index.json`.
4. `node scripts/seed-demo-company.mjs --pack <id> --db /tmp/x.sqlite --init`
   and read the reconciliation table. Record what you see in
   `expected_reconciliation[]`, including the direction and the cause.
5. `pnpm vitest run tests/main/demo-packs.test.ts`

Sources were retrieved 2026-08-13; all four are the most recent reports
published as of that date.
