# Destination (CARPHA) metadata findings

Issues found on the CARPHA staging instance during the proof-of-concept (September 2026), what the
pipeline does about each one today, and what needs to happen for the workaround to be removed.
Instance UIDs are intentionally omitted — look them up on your own instance by the names/codes below.

## Blocking issues (worked around in the pipeline)

| # | Finding | Effect if unhandled | Current workaround | Permanent fix (CARPHA side) |
|---|---|---|---|---|
| 1 | ARI data element (*Syn Fever and Respiratory symptoms*) has **no code** | Code-based push can't address it | TEMP UID override `CARPHA_ARI_CASES` in `1_loadMapping.js` | Set code `CARPHA_ARI_CASES` |
| 2 | **Two category option combos named "default"**: the real one (used by the form, history and completeness) has no code; an orphan duplicate with **no category options** carries the code `default` | Anything resolving `default` by code writes to the orphan — values are stored twice and double-count | TEMP UID override for `default` (also used as attribute option combo) | Remove the code from (or delete) the orphan default COC; clean up any values written to it |
| 3 | COVID lab-result COCs (`+ve` / `-ve`) have **no codes** | E7613 conflict; with the default `atomicMode=ALL` the whole push is discarded | COVID block commented out (loadMapping + transform); UID overrides prepared but commented | Set `LAB_POS` / `LAB_NEG` |
| 4 | Age category options had **no data-write sharing** | E7613 on every age-disaggregated value | Data-entry user group given data read/write (metadata read only) on the three age options on staging | Replicate the sharing change in production |

## Structural quirks the mapping follows

- **Age disaggregation**: the data element category combo is *Age × Gender*, but the data entry form
  and all historical data use three legacy **single-option** COCs — `< 5 years` (`SURV_AGE_LT5`),
  `>=5 years` (`SURV_AGE_GTE5`), `Age unspecified` (`SURV_AGE_UNSP`). The pipeline targets these.
  They must not be removed by a COC regeneration.
- **Haemorrhagic / Neurological fever** use the default category combo, but the form and history store
  them on the `Age unspecified` COC. The pipeline follows the form (`SURV_AGE_UNSP`).
- **Code spellings differ from the original coordination proposal** — the pipeline matches the instance:

  | Proposed | On instance (used) |
  |---|---|
  | `CARPHA_COVID_TESTS_WEEKLY` | `CARPHA_COVID_TEST_WEEKLY` |
  | `CARPHA_COVID_TESTS_CUM` | `CARPHA_COVID_TEST_CUM` |
  | `SURV_SITES_LAB_REPORTED` | `SURV_SITES_LABS_REPORTED` |

- The dataset period type is **WeeklySunday** (`YYYYSunWnn`, epi weeks).
- Site reporting is **10 separate data elements** (expected/received × Hospitals, Health Centres,
  Private Physician/Sentinel, Laboratories, Other/collective), not one data element with a site-type category.

## Housekeeping (non-blocking)

- The service account's role carries many metadata-creation authorities; production should be limited
  to data entry + completeness for the country org unit.
- A test org unit is assigned to the dataset.
- Name typos ("Recieved", a double space, a trailing space in a short name).
- Two hospital COVID data elements on the form have no codes and no GRD source.

## Removing the workarounds once CARPHA fixes 1–3

1. `1_loadMapping.js`: delete the matching entries from `state.carphaOverrides` (keep the object, it can be empty).
2. Uncomment the COVID block (`state.covidMapping`) and the `LAB_*` overrides only if still needed; uncomment section 2 in `3_transform.js`.
3. Optional: in `5_pushData.js`, switch `dataElementIdScheme`/`categoryOptionComboIdScheme`/`attributeOptionComboIdScheme`
   back to `CODE` and drop the resolve step — or keep it; runtime resolution also acts as a check that every code exists.
