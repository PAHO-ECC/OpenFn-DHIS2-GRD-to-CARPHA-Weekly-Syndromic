# OpenFn: GRD → CARPHA Weekly Syndromic Surveillance

An OpenFn Lightning workflow that sends each week's syndromic surveillance data from a
**national DHIS2** to the **CARPHA regional DHIS2** *Weekly Syndromic Reporting Form*, with no manual steps.
Grenada was the first country connected.

The workflow takes facility-level data broken down by age and sex and adds it up to national totals. It reshapes the
totals into CARPHA's age groups, counts reporting sites by type, posts the values and marks the week complete.

**Status: in production.** Tested end to end against CARPHA staging (September–October 2026) and now running weekly
against production. The last remaining metadata workaround is described in
[docs/DESTINATION_METADATA_FINDINGS.md](docs/DESTINATION_METADATA_FINDINGS.md).

### Why

Before this, surveillance officers entered weekly cases in their national DHIS2 and then typed the same numbers
into the CARPHA regional form. They also summed 14 age and sex bands by hand into CARPHA's "under 5" and "5 and over".
Late entries and corrections rarely reached CARPHA. The workflow removes the second data entry and re-sends the
previous week on each run, so corrections flow through.

---

## Contents

| Path | What it is |
|---|---|
| `workflow/workflow.yaml` | The workflow's structure: the cron trigger, the six steps in order, each step's adaptor, which step uses which credential, and the edges between steps. Use it as the blueprint when recreating the workflow in Lightning. |
| `workflow/1_loadMapping.js` | **All configuration and mapping in one place.** <ul><li>`state.config`: source and destination dataset codes, country org unit codes, the facility-type group set code, and the **`includeWeekBeforeLast` yes/no switch**.</li><li>The syndromic data element map (GRD `SS_*` → CARPHA `CARPHA_*`).</li><li>The age × sex → age-group rollup, and the zero-fill list.</li><li>The site-type bucket rules.</li><li>`state.carphaOverrides`, a small table of UIDs for destination objects that have no usable code (placeholder values in this repo).</li></ul> |
| `workflow/2_pullData.js` | Works out which **epi week(s)** to send (see *Epi weeks* below). Resolves the source country org unit and dataset from their codes, then pulls those weeks' data values for all facilities, with codes in the response. Also pulls the `FACILITY_TYPE` org unit group set, used to count reporting sites. Set `state.overridePeriod` (e.g. `2026SunW37`) on the input to re-send one specific week. |
| `workflow/3_transform.js` | Runs once per period. <ol><li>**Syndromic:** sums the 14 source age × sex COCs into CARPHA `< 5` / `≥ 5` for ARI, Gastroenteritis and Undifferentiated Fever. For Haemorrhagic and Neurological fever it sums them into `Age unspecified`.</li><li>**Zero-fill:** fills every expected cell with 0, including `Age unspecified` for the age-split syndromes, but only for weeks the country actually reported. A missing report is never turned into "0 cases".</li><li>**Sites:** each facility goes into exactly one CARPHA site type to give "expected" (first match wins: Hospital → Private Physician → Lab → Health Centre → Other). Facilities with any data that week count as "reported".</li><li>**Outbreak flag:** always `false`.</li></ol> It warns if the source sends an age or sex COC the mapping doesn't know, and drops the bulky source data from state before the next step. |
| `workflow/4_validate.js` | Sanity check: stops the run on negative values and warns on values above 9999. |
| `workflow/5_pushData.js` | <ul><li>Reads the CARPHA dataset's data elements and COCs and **resolves every CARPHA code to its UID** at run time. Entries in the override table win over the lookup.</li><li>Values that can't be resolved are dropped and logged instead of failing the push.</li><li>Posts to `dataValueSets` with `atomicMode=NONE`, so one bad row doesn't discard the rest. A 409 from partial conflicts is caught, so completion and notify still run.</li><li>Registers **completeness** for every pushed period.</li></ul> |
| `workflow/6_notify.js` | Logs a run summary (periods, import counts, conflicts, rows per period, site figures) and keeps a compact `auditLog` in the final state. |
| `mapping/grd-carpha-mapping-demo.xlsx` | A readable **mapping table with codes only, no UIDs**. It documents what `1_loadMapping.js` encodes; the workflow doesn't read it. Sheets: <ul><li>`README`</li><li>`GRD_Mapping`: one row per CARPHA target cell, with the source code(s), CARPHA data element and COC codes, rollup rule, notes and status.</li><li>`CARPHA_Targets`: the distinct CARPHA cells written.</li><li>`Rollup_Rules`</li></ul> |
| `mapping/grd-carpha-mapping-demo.csv` | The `GRD_Mapping` sheet as CSV, for diffs and reviews. |
| `docs/DESTINATION_METADATA_FINDINGS.md` | What was missing or unexpected on the CARPHA instance, what's been fixed, the one workaround still in place, and how to remove it. |
| `LICENSE` | GNU General Public License v3.0. |

---

## How the data flows

```
Cron (weekly)
  → loadMapping   config + mapping tables into state
  → pullData      national DHIS2: resolve OU/dataset codes → pull the week(s) + facility group set   [source credential]
  → transform     per period: syndromic rollup + zero-fill, site counts, outbreak flag
  → validate      no negatives; warn on outliers
  → pushData      CARPHA DHIS2: resolve codes → UIDs, push dataValueSets, mark complete            [destination credential]
  → notify        summary + audit log
```

### Mapping summary (Grenada)

| Source (code) | CARPHA target | Disaggregation |
|---|---|---|
| `SS_ARI` | `CARPHA_ARI_CASES` | `< 5` / `≥ 5` (male + female summed); `Age unspecified` = 0 |
| `SS_GASTRO` | `CARPHA_GAS_CASES` | same |
| `SS_FEV_UNDIFF` | `CARPHA_UDF_CASES` | same |
| `SS_FEV_HAEM` | `CARPHA_HEM_CASES` | all 14 bands → `Age unspecified` |
| `SS_FEV_NEURO` | `CARPHA_NEU_CASES` | all 14 bands → `Age unspecified` |
| `FACILITY_TYPE` group set + weekly reporting | `SURV_SITES_{HOSP,PP,LAB,HC,OTHER}_EXPECTED` / `_REPORTED` (labs reported = `SURV_SITES_LABS_REPORTED`) | default |
| constant | `SURV_OUTBREAKS_FLAG` = `false` | default |
| `SS_FEV_RASH`, `SS_AFP` | — (no CARPHA target) | not mapped |

Source age × sex COC codes: `GRD_{M,F}_{LT1, 1_4, 5_14, 15_24, 25_44, 45_64, 65PLUS}`.

### Epi weeks

Periods are DHIS2 `WeeklySunday` (`YYYYSunWnn`), calculated as **epi weeks**:
- weeks run Sunday to Saturday;
- **week 1 is the week containing 4 January**;
- a week that spans New Year belongs to the year that contains its Wednesday (the year with at least 4 of its days),
  so some years have a **week 53**.

This matches the CDC MMWR convention; 2014, 2020 and 2025 have a week 53. Calculations use UTC.
By default each run sends the **last complete epi week**. With `includeWeekBeforeLast: 'yes'` it also re-sends the week
before, to pick up late entries and corrections. In week 1, "the week before" rolls back to W52 or W53 of the previous year.

---

## Setup

1. **Credentials.** In Lightning, go to Project settings → Credentials and create two of type DHIS2:
   - *source*: the country DHIS2, with read access to the weekly surveillance dataset and the org unit hierarchy;
   - *destination*: the CARPHA DHIS2 service account, with **data write** on the Weekly Syndromic Reporting Form for the
     country org unit and data-write sharing on the category options it writes to (see the findings doc).
2. **Workflow.** Create it following `workflow/workflow.yaml`. Paste each `.js` file into its step, attach the
   credentials to `pullData` and `pushData`, and add the cron trigger. Choose a schedule that runs after the country's
   weekly reporting deadline.
3. **Configure `1_loadMapping.js`:**
   - `state.config`: dataset codes, the source and destination country org unit codes, the facility-type group set code,
     and `includeWeekBeforeLast` (`'yes'` / `'no'`);
   - `state.carphaOverrides`: replace each `YOUR_…` placeholder with the destination instance's UID. Delete an entry once
     the destination sets that code.
4. **Test.** Run it once manually, optionally with `overridePeriod` on the input state. In the pushData log, check for
   `Resolved N of N values` and `Push: SUCCESS … Conflicts: 0`.

> **Lightning editor tip:** clicking *Run* in a browser tab saves that tab's code first. If the workflow was changed
> somewhere else (an API deploy or another tab), reload the editor before running, or you'll overwrite the newer code.

### Adding another country

The workflow is written to be reused. For a new country:
- copy the workflow;
- change `state.config`;
- replace the source codes in the syndromic map and the age × sex COC lists in `1_loadMapping.js`;
- adjust the site-type bucket rules to that country's facility groups.

Everything on the CARPHA side (data elements, age COCs, site data elements) stays the same.

---

## Design notes

- **Codes, not UIDs.** Everything is addressed by DHIS2 `code`, so the same workflow works on staging and production.
  DHIS2 accepts only one id scheme per object type per request. Because some codes are missing on the destination, the
  push step resolves codes to UIDs at run time and sends UIDs. The org unit and dataset still go by code.
- **atomicMode=NONE.** DHIS2's default (`ALL`) throws away the whole payload if any single value conflicts. With `NONE`,
  valid values land and conflicts are reported.
- **Zero-fill only when reported.** A week with no country data sends nothing at all rather than a column of zeros.
- **Small state.** Lightning runs have payload and time limits, so each step passes on only what later steps need.
  Only the week(s) being sent are pulled. An earlier version pulled year-to-date data for COVID-19 totals, and its runs
  were killed by the time limit. COVID-19 has since been removed.

## What is *not* in this repo

- **No instance identifiers:** no UIDs, hostnames, URLs, usernames or tokens. The override table uses `YOUR_…`
  placeholders, and comments that referred to specific instances were made generic.
- Run logs, surveillance data, and correspondence with partners.

## License

[GNU General Public License v3.0](LICENSE). You may use, change and share this work. Shared copies and changed versions
must also be released under GPL-3.0.
