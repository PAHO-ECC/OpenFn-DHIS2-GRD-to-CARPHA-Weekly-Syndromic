fn(state => {
  const { weekValues, ytdValues, facilityGroupSet, synMapping, covidMapping, sitesMapping, periods, config } = state;
  const out = [];
  const mkRow = (period, deCode, cocCode, value) => out.push({
    dataElement:          deCode,
    categoryOptionCombo:  cocCode,
    attributeOptionCombo: config.carphaDefaultCocCode,
    orgUnit:              config.carphaCountryOuCode,
    period,
    value:                value.toString()
  });

  // ── Shared lookups (same for every period) ──
  const k = (de, coc) => de + '||' + coc;
  const lookup = {};
  synMapping.forEach(r => { const key = k(r.srcDeCode, r.srcCocCode); if (!lookup[key]) lookup[key] = []; lookup[key].push(r); });

  // Guard: warn if GRD starts sending age/sex COCs the mapping doesn't know (they would be silently dropped)
  const srcDeCodes = new Set(synMapping.map(r => r.srcDeCode));
  const srcCocCodes = new Set(synMapping.map(r => r.srcCocCode));
  const unmappedCocs = [...new Set(weekValues.filter(dv => srcDeCodes.has(dv.dataElement) && !srcCocCodes.has(dv.categoryOptionCombo)).map(dv => dv.dataElement + '/' + dv.categoryOptionCombo))];
  if (unmappedCocs.length) console.warn('WARNING unmapped source COCs (values dropped): ' + JSON.stringify(unmappedCocs));

  // Sites: OU → bucket assignment is period-independent (priority de-duplication, first match wins)
  const ouCodePrefix = config.countryCode + '-';
  const groupsByCode = {};
  (facilityGroupSet.organisationUnitGroups || []).forEach(g => {
    if (!g.code) return;
    groupsByCode[g.code] = (g.organisationUnits || [])
      .filter(ou => (ou.code || '').startsWith(ouCodePrefix) && ou.code !== config.countryOuCode)
      .map(ou => ou.code);
  });
  const claimed = new Set();
  const bucketOus = {};
  sitesMapping.forEach(rule => {
    const ouCodesForBucket = new Set();
    rule.srcGroupCodes.forEach(srcCode => {
      (groupsByCode[srcCode] || []).forEach(ouCode => { if (!claimed.has(ouCode)) ouCodesForBucket.add(ouCode); });
    });
    ouCodesForBucket.forEach(ouCode => claimed.add(ouCode));
    bucketOus[rule.carphaBucket] = ouCodesForBucket;
  });

  // ── Per-period transform (last week, plus the week before when switched on) ──
  const summaryByPeriod = {};
  periods.forEach(period => {
    const pValues = weekValues.filter(dv => dv.period === period);
    const startRows = out.length;

    // 1. Syndromic rollup
    const synAcc = {};
    pValues.forEach(dv => {
      const rows = lookup[k(dv.dataElement, dv.categoryOptionCombo)];
      if (!rows) return;
      rows.forEach(r => {
        const ck = k(r.tgtDeCode, r.tgtCocCode);
        if (!synAcc[ck]) synAcc[ck] = { sum: 0, deCode: r.tgtDeCode, cocCode: r.tgtCocCode };
        synAcc[ck].sum += parseFloat(dv.value) || 0;
      });
    });
    // Zero-fill missing cells (e.g. Age unspecified for ARI/GAS/UDF) — only if GRD reported this week at all
    if (pValues.length) (state.synZeroFill || []).forEach(z => {
      const ck = k(z.de, z.coc);
      if (!synAcc[ck]) synAcc[ck] = { sum: 0, deCode: z.de, cocCode: z.coc };
    });
    Object.values(synAcc).forEach(e => mkRow(period, e.deCode, e.cocCode, e.sum));

    // 2. COVID weekly + cumulative — DISABLED for staging test (see loadMapping)
    let wkCases = 0, wkTests = 0, wkNeg = 0, ytdCases = 0, ytdTests = 0, ytdNeg = 0;
    /*const cm = covidMapping;
    const sumByCode = (vals, code) => vals
      .filter(dv => dv.dataElement === code && cm.allGrdCocs.includes(dv.categoryOptionCombo))
      .reduce((a, b) => a + (parseFloat(b.value) || 0), 0);
    wkCases = sumByCode(pValues, cm.srcCases);
    wkTests = sumByCode(pValues, cm.srcTests);
    wkNeg   = Math.max(0, wkTests - wkCases);
    mkRow(period, cm.tgtWeekly, cm.cocPos, wkCases);
    mkRow(period, cm.tgtWeekly, cm.cocNeg, wkNeg);
    // YTD up to and including this period (ytdValues is pulled up to last week; same year only)
    const ytdUpTo = ytdValues.filter(dv => dv.period.slice(0, 4) === period.slice(0, 4) && dv.period <= period);
    ytdCases = sumByCode(ytdUpTo, cm.srcCases);
    ytdTests = sumByCode(ytdUpTo, cm.srcTests);
    ytdNeg   = Math.max(0, ytdTests - ytdCases);
    mkRow(period, cm.tgtCum, cm.cocPos, ytdCases);
    mkRow(period, cm.tgtCum, cm.cocNeg, ytdNeg);*/

    // 3. Sites Expected/Reported — reported = bucket OUs with any data in this period
    const reportingOuCodes = new Set(pValues.map(dv => dv.orgUnit));
    const expByBucket = {}, repByBucket = {};
    sitesMapping.forEach(rule => {
      const ous = bucketOus[rule.carphaBucket];
      expByBucket[rule.carphaBucket] = ous.size;
      repByBucket[rule.carphaBucket] = [...ous].filter(ou => reportingOuCodes.has(ou)).length;
      mkRow(period, rule.expectedCode, config.carphaDefaultCocCode, expByBucket[rule.carphaBucket]);
      mkRow(period, rule.reportedCode, config.carphaDefaultCocCode, repByBucket[rule.carphaBucket]);
    });

    // Default 'No' for SURV_OUTBREAKS_FLAG (BOOLEAN — always false for GRD weekly reporting)
    mkRow(period, 'SURV_OUTBREAKS_FLAG', config.carphaDefaultCocCode, 'false');

    summaryByPeriod[period] = {
      sourceValues: pValues.length,
      synRows:      Object.keys(synAcc).length,
      covidWeek:    { cases: wkCases, tests: wkTests, neg: wkNeg },
      covidYtd:     { cases: ytdCases, tests: ytdTests, neg: ytdNeg },
      sites:        { expected: expByBucket, reported: repByBucket },
      totalRows:    out.length - startRows
    };
    console.log('Transform results ' + period + ':');
    console.log('  Source values: ' + pValues.length + ' | Syndromic rows: ' + Object.keys(synAcc).length + ' | COVID: disabled for staging test');
    console.log('  Sites: expected=' + JSON.stringify(expByBucket) + ' reported=' + JSON.stringify(repByBucket));
    out.slice(startRows).forEach(dv => console.log('  ' + dv.dataElement + ' / ' + dv.categoryOptionCombo + ' = ' + dv.value));
  });
  console.log('(' + claimed.size + ' unique OUs bucketed) | Total CARPHA values: ' + out.length);

  // ── Cleanup: drop bulky source data so state stays small for validate/push/notify ──
  // ytdValues alone is ~80k rows; weekValues ~4k; combined > 32MB serialized.
  return {
    config:            state.config,
    period:            state.period,
    periods:           state.periods,
    carphaOverrides:   state.carphaOverrides,
    carphaDataValues:  out,
    transformSummary: {
      byPeriod:   summaryByPeriod,
      ouCount:    claimed.size,
      totalRows:  out.length
    }
  };
});
