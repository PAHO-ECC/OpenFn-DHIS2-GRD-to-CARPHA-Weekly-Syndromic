fn(state => {
  const { config, period, periods, pushResult, transformSummary, droppedValues } = state;
  if ((droppedValues || []).length) console.log('Dropped before push (unresolved CARPHA codes): ' + droppedValues.length);
  console.log('=== CARPHA Push Summary ===');
  console.log('Country: ' + (config.countryCode || 'GRD'));
  console.log('Periods: ' + (periods || [period]).join(', '));
  if (pushResult) {
    console.log('Status:  ' + pushResult.status);
    console.log('Imported: ' + pushResult.imported + ' | Updated: ' + pushResult.updated + ' | Ignored: ' + pushResult.ignored);
    console.log('Conflicts: ' + (pushResult.conflicts || []).length);
  }
  if (transformSummary) {
    console.log('Transform: ' + transformSummary.totalRows + ' rows | sites OUs ' + transformSummary.ouCount);
    Object.entries(transformSummary.byPeriod || {}).forEach(([p, t]) => {
      console.log(p + ': ' + t.totalRows + ' rows (' + t.synRows + ' syndromic) | sites expected ' + JSON.stringify(t.sites.expected) + ' reported ' + JSON.stringify(t.sites.reported));
    });
  }
  return {
    config, period, periods,
    auditLog: {
      country: config.countryCode || 'GRD',
      period,
      periods,
      status: pushResult ? pushResult.status : 'NO_PUSH',
      imported: pushResult ? pushResult.imported : 0,
      updated:  pushResult ? pushResult.updated  : 0,
      conflicts: pushResult ? (pushResult.conflicts || []).length : 0,
      transformSummary,
      timestamp: new Date().toISOString()
    }
  };
});