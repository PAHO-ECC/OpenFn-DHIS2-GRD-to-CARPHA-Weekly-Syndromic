// ── Resolve CARPHA codes → UIDs (needed while some destination objects lack codes) ──
// Some CARPHA objects have no code or a wrong one (see state.carphaOverrides in loadMapping), and
// DHIS2 allows only ONE idScheme per object type per request. So DEs and COCs are resolved to UIDs here:
// overrides first, then a code lookup against the CARPHA dataset. OU + dataset still go by CODE.
get('dataSets', state => ({
  filter: 'code:eq:' + state.config.carphaDataSetCode,
  fields: 'id,code,dataSetElements[dataElement[id,code,categoryCombo[categoryOptionCombos[id,code]]]]',
  paging: false
}));
fn(state => {
  const list = (state.data && state.data.dataSets) || [];
  if (!list.length) throw new Error('CARPHA dataset code not found: ' + state.config.carphaDataSetCode);
  const ov = state.carphaOverrides || { dataElements: {}, categoryOptionCombos: {} };
  const deUid = { ...ov.dataElements }, cocUid = { ...ov.categoryOptionCombos };
  list[0].dataSetElements.forEach(({ dataElement: de }) => {
    if (de.code && !deUid[de.code]) deUid[de.code] = de.id;
    (de.categoryCombo.categoryOptionCombos || []).forEach(c => { if (c.code && !cocUid[c.code]) cocUid[c.code] = c.id; });
  });

  const resolved = [], dropped = [];
  state.carphaDataValues.forEach(dv => {
    const de = deUid[dv.dataElement], coc = cocUid[dv.categoryOptionCombo], aoc = cocUid[dv.attributeOptionCombo];
    if (de && coc && aoc) resolved.push({ ...dv, dataElement: de, categoryOptionCombo: coc, attributeOptionCombo: aoc });
    else dropped.push(dv.dataElement + ' / ' + dv.categoryOptionCombo + (de ? '' : ' [DE code not on CARPHA]') + (coc ? '' : ' [COC code not on CARPHA]'));
  });
  console.log('Resolved ' + resolved.length + ' of ' + state.carphaDataValues.length + ' values to CARPHA UIDs');
  if (dropped.length) console.warn('Dropped (unresolved codes): ' + JSON.stringify(dropped));
  const { data, ...rest } = state;
  return { ...rest, carphaPushValues: resolved, droppedValues: dropped };
});

create(
  'dataValueSets',
  state => ({ dataValues: state.carphaPushValues }),
  {
    importStrategy:                'CREATE_AND_UPDATE',
    atomicMode:                    'NONE',   // default ALL discards every row if any single row conflicts
    // dataElementIdScheme:           'CODE',
    // categoryOptionComboIdScheme:   'CODE',
    // attributeOptionComboIdScheme:  'CODE',
    dataElementIdScheme:           'UID',    // TEMP: resolved above — switch back to CODE once CARPHA codes are fixed
    categoryOptionComboIdScheme:   'UID',
    attributeOptionComboIdScheme:  'UID',
    orgUnitIdScheme:               'CODE',
    dataSetIdScheme:               'CODE'
  }
).catch((error, state) => {
  // DHIS2 answers 409 whenever any row conflicts, even though the rest were imported (atomicMode NONE).
  // Keep the import summary and carry on so completion + notify still run.
  const body = error && error.body;
  if (!body || !body.response) throw error;
  return { ...state, data: body };
});

fn(state => {
  const resp = (state.data && state.data.response) || state.data || {};
  const ic = resp.importCount || {};
  console.log('Push: ' + resp.status + ' | imported:' + ic.imported + ' updated:' + ic.updated + ' ignored:' + ic.ignored);
  if ((resp.conflicts || []).length) console.error('Conflicts:', JSON.stringify(resp.conflicts, null, 2));
  // Drop state.data (raw API response) — only keep distilled pushResult
  const { data, ...rest } = state;
  return {
    ...rest,
    pushResult: { status: resp.status, ...ic, conflicts: resp.conflicts || [] }
  };
});
// ── Mark dataset complete (every pushed period) ──
create(
  'completeDataSetRegistrations',
  state => ({
    completeDataSetRegistrations: state.periods.map(period => ({
      dataSet:          state.config.carphaDataSetCode,
      period,
      organisationUnit: state.config.carphaCountryOuCode,
      completed:        true
    }))
  }),
  {
    dataSetIdScheme:  'CODE',
    orgUnitIdScheme:  'CODE'
  }
);

fn(state => {
  const { data, ...rest } = state;
  const resp = data || {};
  console.log('Dataset marked complete for ' + state.periods.join(', ') + ': status=' + (resp.status || 'sent'));
  return rest;
});
