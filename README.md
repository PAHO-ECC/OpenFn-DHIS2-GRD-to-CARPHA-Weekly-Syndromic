# OpenFn: GRD → CARPHA Weekly Syndromic Surveillance

An OpenFn Lightning workflow that takes each week's syndromic surveillance data from
**Grenada's national DHIS2** (facility level, age × sex), aggregates it to the national level, reshapes it to
CARPHA's regional form, and pushes it to the **CARPHA regional DHIS2** *Weekly Syndromic Reporting Form*.
It then marks the week complete. It runs every Monday with no manual steps.

Status: **proof of concept**. It ran end to end against a CARPHA staging instance in September 2026, pushing
two consecutive epi weeks with zero import conflicts. A few metadata workarounds are still in place (see
[docs/DESTINATION_METADATA_FINDINGS.md](docs/DESTINATION_METADATA_FINDINGS.md)).

---

## Contents

| Path | What it is |
|---|---|
| `workflow/workflow.yaml` | Workflow structure: the cron trigger, the six steps in order, the adaptor for each, which credential each step uses, and the edges between them. Use it as the blueprint to recreate the workflow in Lightning. |
| `workflow/1_loadMapping.js` | **All configuration and mapping in one place.** Holds `state.config` (source/destination dataset and org unit codes, the facility-type group set code, and the **`includeWeekBeforeLast` yes/no switch**). Also holds the syndromic data element map (GRD `SS_*` → CARPHA `CARPHA_*`), the age/sex → age-band rollup, the zero-fill list, the site-type bucket rules, the disabled COVID block, and `state.carphaOverrides`, the temporary UID override table (placeholders in this repo). |
| `workflow/2_pullData.js` | Works out which **epi week(s)** to send (see *Epi weeks* below). Resolves the GRD country org unit and dataset from their codes, then pulls the week(s)' data values for all facilities with codes in the response. It also pulls year-to-date values (for the COVID cumulative figures) and the `FACILITY_TYPE` org unit group set used to count reporting sites. Set `state.overridePeriod` (e.g. `2026SunW37`) to re-send a specific week. |
| `workflow/3_transform.js` | Runs once per period. **(1) Syndromic:** sums the 14 GRD age × sex COCs into CARPHA `< 5` / `≥ 5` for ARI, Gastroenteritis and Undifferentiated Fever, and into `Age unspecified` for Haemorrhagic and Neurological fever. **Zero-fills** every expected cell (including `Age unspecified` for the age-split syndromes), but only for weeks GRD actually reported, so a missing report isn't turned into "0 cases". **(2) COVID** weekly/cumulative: commented out. **(3) Sites:** each GRD facility is assigned to exactly one CARPHA site type (first match wins: Hospital → Private Physician → Lab → Health Centre → Other) to give "expected"; facilities with any data that week give "reported". **(4)** Outbreak flag, always `false`. Warns if GRD sends an age/sex COC the mapping doesn't know. Drops the bulky source data from state before the next step. |
| `workflow/4_validate.js` | Sanity check: stops the run on negative values and warns on values above 9999. |
| `workflow/5_pushData.js` | Reads the CARPHA dataset's data elements and COCs, and **resolves every CARPHA code to its UID** at run time. Override table entries win over the lookup. Values that can't be resolved are dropped and logged instead of failing the push. It then posts to `dataValueSets` with `atomicMode=NONE`, so one bad row doesn't discard the rest. A 409 caused by partial conflicts is caught so completion and notify still run. Finally it registers **completeness** for every pushed period. |
| `workflow/6_notify.js` | Logs a run summary (periods, import counts, conflicts, per-period row counts and site figures) and keeps a compact `auditLog` in the final state. |
| `mapping/grd-carpha-mapping-demo.xlsx` | Human-readable **mapping table, codes only, no UIDs**. Sheets: `README`, `GRD_Mapping` (one row per CARPHA target cell: GRD source code(s), CARPHA DE/COC code, rollup rule, notes, status), `CARPHA_Targets` (the distinct CARPHA cells written), `Rollup_Rules` (DIRECT / ROLLUP_SEX_TO_AGE / ROLLUP_TOTAL_ONLY / SITES_DERIVE …). This is documentation of what `1_loadMapping.js` encodes. The workflow doesn't read it. |
| `mapping/grd-carpha-mapping-demo.csv` | The `GRD_Mapping` sheet as CSV, for diffs and reviews. |
| `docs/DESTINATION_METADATA_FINDINGS.md` | What was wrong or unexpected on the destination instance (missing codes, duplicate default COC, sharing, structural quirks), how the pipeline currently works around each issue, and how to remove the workarounds. |
| `LICENSE` | Creative Commons Attribution 4.0 International (CC BY 4.0). |

---

## How the data flows

```
Cron (Mon 06:00 UTC)
  → loadMapping   config + mapping tables into state
  → pullData      GRD DHIS2: resolve OU/dataset codes → pull week(s) + YTD + facility group set   [source credential]
  → transform     per period: syndromic rollup + zero-fill, site counts, outbreak flag
  → validate      no negatives; warn on outliers
  → pushData      CARPHA DHIS2: resolve codes → UIDs, push dataValueSets, mark complete        [destination credential]
  → notify        summary + audit log
```

### Mapping summary

| GRD source (code) | CARPHA target | Disaggregation |
|---|---|---|
| `SS_ARI` | `CARPHA_ARI_CASES` | `< 5` / `≥ 5` (M+F summed); `Age unspecified` = 0 |
| `SS_GASTRO` | `CARPHA_GAS_CASES` | same |
| `SS_FEV_UNDIFF` | `CARPHA_UDF_CASES` | same |
| `SS_FEV_HAEM` | `CARPHA_HEM_CASES` | all 14 bands → `Age unspecified` |
| `SS_FEV_NEURO` | `CARPHA_NEU_CASES` | all 14 bands → `Age unspecified` |
| `FACILITY_TYPE` group set + weekly reporting | `SURV_SITES_{HOSP,PP,LAB,HC,OTHER}_EXPECTED` / `_REPORTED` (LAB reported = `SURV_SITES_LABS_REPORTED`) | default |
| constant | `SURV_OUTBREAKS_FLAG` = `false` | default |
| `SURV_COVID_CASES`, `SURV_COVID_TESTS` | `CARPHA_COVID_TEST_WEEKLY` / `_CUM` (+ve / −ve) | **disabled** |
| `SS_FEV_RASH`, `SS_AFP` | — (no CARPHA target) | not mapped |

GRD source age × sex COC codes: `GRD_{M,F}_{LT1, 1_4, 5_14, 15_24, 25_44, 45_64, 65PLUS}`.

### Epi weeks

Periods are DHIS2 `WeeklySunday` (`YYYYSunWnn`), computed as **epi weeks**:
- weeks run Sunday to Saturday;
- **week 1 is the week containing 4 January**;
- a week that spans New Year belongs to the year holding its Wednesday (the year with ≥ 4 of its days), so some years have a **week 53**.

This matches the CDC MMWR convention (2014, 2020 and 2025 have W53). Calculations use UTC. By default the run sends the
**last complete epi week**. With `includeWeekBeforeLast: 'yes'` it also re-sends the week before, to pick up late
entries and corrections. Week 1 rolls back to W52/W53 of the previous year.

---

## Setup

1. **Credentials** (Lightning → Project settings → Credentials, DHIS2 type):
   - *source* — the country DHIS2, read access to the weekly surveillance dataset and org unit hierarchy;
   - *destination* — the CARPHA DHIS2 service account with **data write** on the Weekly Syndromic Reporting Form
     for the country org unit, and data write sharing on the category options it writes to (see findings doc).
2. **Workflow**: create it following `workflow/workflow.yaml`. Paste each `.js` file into its step, attach the
   credentials to `pullData` and `pushData`, and add the cron trigger.
3. **Configure `1_loadMapping.js`**:
   - `state.config`: dataset codes, country org unit codes (source and destination), facility-type group set code,
     and `includeWeekBeforeLast` (`'yes'` / `'no'`);
   - `state.carphaOverrides`: replace the `YOUR_…_UID` placeholders with the destination instance's UIDs for any
     object that has no usable code. Delete an entry once the destination sets the code.
4. **Test**: run once manually (optionally with `overridePeriod` on the input state). Check the pushData log for
   `Resolved N of N values` and `Push: SUCCESS … Conflicts: 0`.

> **Lightning editor tip:** clicking *Run* in a browser tab saves that tab's code first. If the workflow was
> changed elsewhere (API deploy, another tab), reload the editor before running or you'll overwrite the newer code.

---

## Design notes

- **Codes, not UIDs.** Everything is addressed by DHIS2 `code` so the same workflow works across staging and
  production. DHIS2 accepts only one id scheme per object type per request, so where the destination is missing
  codes the push step resolves codes to UIDs at run time and sends UIDs. The org unit and dataset still go by code.
- **atomicMode=NONE.** DHIS2's default (`ALL`) discards the whole payload if any single value conflicts. With `NONE`,
  valid values land and conflicts are reported.
- **Zero-fill only when reported.** A week with no GRD data sends nothing at all rather than a column of zeros.
- **State hygiene.** Year-to-date pulls are large (~190k values). The transform returns a slim state so later
  steps stay under Lightning's payload limit.

## What is *not* in this repo

- **No instance identifiers:** no UIDs, hostnames, URLs, usernames or tokens. The UID override table uses
  `YOUR_…_UID` placeholders, and instance-specific comments were genericized.
- The CARPHA canonical metadata *proposal* and the original full multi-country mapping workbook. They contain
  instance or placeholder UIDs and pre-date what the staging test established.
- Run logs, staging data and correspondence.

## License

[CC BY 4.0](LICENSE). Free to share and adapt with attribution.
