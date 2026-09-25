fn(state => {
  // ── Epi weeks (Sunday–Saturday) ──
  // Week 1 = the Sunday-starting week that contains 4 January. A week belongs to the year holding
  // its Wednesday (i.e. the year with ≥4 of its days), so some years have a week 53.
  // Dates are handled in UTC so server timezone / DST can't shift a day.
  const DAY = 86400000;
  const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
  const week1Sunday = y => { const jan4 = utc(y, 0, 4); return new Date(jan4 - jan4.getUTCDay() * DAY); };
  const toPeriod = d => {
    const sun = new Date(utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - d.getUTCDay() * DAY);
    const yr = new Date(+sun + 3 * DAY).getUTCFullYear();          // year of the week's Wednesday
    const wn = Math.round((sun - week1Sunday(yr)) / (7 * DAY)) + 1;
    return yr + 'SunW' + String(wn).padStart(2, '0');
  };
  const fromPeriod = p => new Date(+week1Sunday(+p.slice(0, 4)) + (parseInt(p.slice(p.indexOf('W') + 1), 10) - 1) * 7 * DAY);
  // const toPeriod = ps => {  // OLD: 7-day blocks counted from 1 Jan — wrong in years where 1 Jan is Mon–Wed
  //   const yr = ps.getFullYear(), soy = new Date(yr, 0, 1);
  //   const doy = Math.floor((ps - soy) / 86400000) + 1;
  //   return yr + 'SunW' + Math.ceil(doy / 7).toString().padStart(2, '0');
  // };

  let period;
  if (state.overridePeriod) {
    period = state.overridePeriod;
    console.log('Using override period: ' + period);
  } else {
    // Last complete epi week = the week before the one containing today
    period = toPeriod(new Date(Date.now() - 7 * DAY));
    console.log('Auto period: ' + period);
  }

  // Week before last — goes through dates so W01 rolls back into the previous year (W52 or W53)
  const periods = [period];
  const includePrev = String(state.config.includeWeekBeforeLast || 'no').toLowerCase() === 'yes';
  if (includePrev) periods.push(toPeriod(new Date(+fromPeriod(period) - 7 * DAY)));
  console.log('Periods to push: ' + periods.join(', ') + (includePrev ? '' : ' (week-before-last switched off)'));

  const yr = period.slice(0, 4);
  const wkN = parseInt(period.slice(-2), 10);
  const ytdPeriods = [];
  for (let i = 1; i <= wkN; i++) ytdPeriods.push(yr + 'SunW' + String(i).padStart(2, '0'));
  return { ...state, period, periods, ytdPeriods };
});

// ── Resolve country OU code → UID (dataValueSets query params require UID) ──
get('organisationUnits', state => ({
  filter: 'code:eq:' + state.config.countryOuCode,
  fields: 'id,code',
  paging: false
}));
fn(state => {
  const list = (state.data && state.data.organisationUnits) || [];
  if (!list.length) throw new Error('Country OU code not found: ' + state.config.countryOuCode);
  state.countryOuUid = list[0].id;
  console.log('Resolved country OU: ' + state.config.countryOuCode + ' → ' + state.countryOuUid);
  return state;
});

// ── Resolve dataset code → UID ──
get('dataSets', state => ({
  filter: 'code:eq:' + state.config.countryDataSetCode,
  fields: 'id,code',
  paging: false
}));
fn(state => {
  const list = (state.data && state.data.dataSets) || [];
  if (!list.length) throw new Error('Dataset code not found: ' + state.config.countryDataSetCode);
  state.countryDataSetUid = list[0].id;
  console.log('Resolved dataset: ' + state.config.countryDataSetCode + ' → ' + state.countryDataSetUid);
  return state;
});

// ── Week data (last week + optionally the week before) — UIDs in filter, CODES in response ──
get('dataValueSets', state => ({
  dataSet:                       state.countryDataSetUid,
  // period:                        state.period,
  period:                        state.periods,
  orgUnit:                       state.countryOuUid,
  children:                      true,
  dataSetIdScheme:               'CODE',
  orgUnitIdScheme:               'CODE',
  dataElementIdScheme:           'CODE',
  categoryOptionComboIdScheme:   'CODE',
  attributeOptionComboIdScheme:  'CODE'
}));
fn(state => {
  state.weekValues = (state.data && state.data.dataValues) || [];
  state.periods.forEach(p => {
    const vals = state.weekValues.filter(d => d.period === p);
    console.log('Week values ' + p + ': ' + vals.length + ' from ' + new Set(vals.map(d => d.orgUnit)).size + ' OUs');
  });
  return state;
});

// ── YTD data ──
get('dataValueSets', state => ({
  dataSet:                       state.countryDataSetUid,
  period:                        state.ytdPeriods,
  orgUnit:                       state.countryOuUid,
  children:                      true,
  dataSetIdScheme:               'CODE',
  orgUnitIdScheme:               'CODE',
  dataElementIdScheme:           'CODE',
  categoryOptionComboIdScheme:   'CODE',
  attributeOptionComboIdScheme:  'CODE'
}));
fn(state => {
  state.ytdValues = (state.data && state.data.dataValues) || [];
  console.log('YTD values: ' + state.ytdValues.length);
  return state;
});

// ── Institution Type group set ──
get('organisationUnitGroupSets', state => ({
  filter: 'code:eq:' + state.config.facilityTypeGroupSetCode,
  fields: 'id,code,name,organisationUnitGroups[code,name,organisationUnits[id,code,name,path]]',
  paging: false
}));
fn(state => {
  const list = (state.data && state.data.organisationUnitGroupSets) || [];
  if (!list.length) throw new Error('OU group set code not found: ' + state.config.facilityTypeGroupSetCode);
  state.facilityGroupSet = list[0];
  const groups = state.facilityGroupSet.organisationUnitGroups || [];
  const summary = groups.map(g => g.code + ':' + (g.organisationUnits || []).length).join(' ');
  console.log('OU group set [' + state.facilityGroupSet.code + '] groups: ' + summary);
  return state;
});