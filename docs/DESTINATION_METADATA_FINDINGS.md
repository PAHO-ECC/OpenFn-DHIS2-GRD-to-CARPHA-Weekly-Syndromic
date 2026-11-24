# Destination (CARPHA) metadata findings

Issues found on the CARPHA instance while building and testing this pipeline (September–November 2026),
what the pipeline does about each one, and what has to happen before a workaround can be removed.
Instance UIDs are left out on purpose. Look objects up on your own instance by the names and codes below.

## Issues and their status

| # | Finding | Effect if not handled | Status / current workaround | Permanent fix (CARPHA side) |
|---|---|---|---|---|
| 1 | ARI data element (*Syn Fever and Respiratory symptoms*) had **no code** | A code-based push can't address it | **Fixed by CARPHA.** The code `CARPHA_ARI_CASES` now exists and the UID override was removed | — |
| 2 | **Two category option combos named "default"**: the real one (used by the form, historical data and completeness) has no code; an orphan duplicate with **no category options** carries the code `default` | Anything that resolves `default` by code writes to the orphan, so values are stored twice and counted twice in analytics | **Still open.** UID override for `default` in `1_loadMapping.js` (also used as the attribute option combo) | Remove the code from the orphan default COC (or delete it), then delete any values written to it |
| 3 | Age category options had **no data-write sharing** | E7613 conflict on every age-disaggregated value | **Fixed on staging** by giving the data-entry user group data read/write (metadata read only) on the three age options | Make the same sharing change in production |

COVID-19 reporting is **out of scope** for this pipeline and has been removed from the code. The CARPHA form's
COVID lab-result COCs (`+ve` / `-ve`) had no codes when this was tested. A country that wants to send COVID data
would need those codes set first.

## Structural quirks the mapping follows

- **Age disaggregation:** the data element category combo is *Age × Gender*, but the data entry form
  and all historical data use three legacy **single-option** COCs: `< 5 years` (`SURV_AGE_LT5`),
  `>=5 years` (`SURV_AGE_GTE5`) and `Age unspecified` (`SURV_AGE_UNSP`). The pipeline targets these.
  They must not be removed by a COC regeneration.
- **Haemorrhagic / Neurological fever** use the default category combo, but the form and history store
  them on the `Age unspecified` COC. The pipeline follows the form (`SURV_AGE_UNSP`).
- **Code spellings differ from the original proposal.** The pipeline uses what is on the instance:
  `SURV_SITES_LABS_REPORTED` (proposed: `SURV_SITES_LAB_REPORTED`).
- The dataset period type is **WeeklySunday** (`YYYYSunWnn`, epi weeks).
- Site reporting is **10 separate data elements** (expected/received × Hospitals, Health Centres,
  Private Physician/Sentinel, Laboratories, Other/collective), not one data element with a site-type category.

## Housekeeping (not blocking)

- The service account's role carries many metadata-creation authorities. In production it should be limited
  to data entry and completeness for the country org unit.
- A test org unit is assigned to the dataset.
- Name typos ("Recieved", a double space, a trailing space in a short name).

## Removing the remaining workaround once CARPHA fixes issue 2

1. `1_loadMapping.js`: delete the `default` entry from `state.carphaOverrides`. Keep the object; it can be empty.
2. Optional: in `5_pushData.js`, switch `dataElementIdScheme` / `categoryOptionComboIdScheme` /
   `attributeOptionComboIdScheme` back to `CODE` and drop the resolve step. Or keep it, since resolving at run
   time also checks that every code exists.
