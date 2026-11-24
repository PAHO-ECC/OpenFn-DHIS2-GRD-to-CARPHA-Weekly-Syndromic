fn(state => {
  state.config = {
    countryCode:                  'GRD',
    countryDataSetCode:           'GRD_WEEKLY_SURV',
    countryOuCode:                'YOUR_GRD_COUNTRY_OU_CODE',
    carphaDataSetCode:            'CARPHA_WEEKLY_SURV',
    carphaCountryOuCode:          'GADM_GRD',
    carphaDefaultCocCode:         'default',
    facilityTypeGroupSetCode:     'FACILITY_TYPE',
    // ── Week-before-last switch ──
    // 'yes' = push last week AND re-push the week before (picks up late GRD entries/corrections)
    // 'no'  = push last week only
    includeWeekBeforeLast:        'yes'
  };

  // SS_FEV_RASH and SS_AFP have no CARPHA target and are not mapped.
  const SYN_DE_MAP = {
    'SS_ARI':        'CARPHA_ARI_CASES',
    'SS_GASTRO':     'CARPHA_GAS_CASES',
    'SS_FEV_UNDIFF': 'CARPHA_UDF_CASES',
    'SS_FEV_HAEM':   'CARPHA_HEM_CASES',
    'SS_FEV_NEURO':  'CARPHA_NEU_CASES'
  };
  // unsp: CARPHA form + history store HEM/NEU totals on the "Age unspecified" COC, not default
  const COC = {
    lt5:'SURV_AGE_LT5', 
    gte5:'SURV_AGE_GTE5', 
    unsp:'SURV_AGE_UNSP', 
    default:'default' };

  state.carphaOverrides = {
    categoryOptionCombos: {
      // KEEP until CARPHA removes code 'default' from the duplicate (orphan) default COC — without this, every value's
      // attribute option combo (and the site/flag COCs) resolve to the ghost and the form shows the week empty
      'default': 'YOUR_CARPHA_DEFAULT_COC_UID'
    }
  };
  const LT5_M  = ['GRD_M_LT1', 'GRD_M_1_4'];
  const LT5_F  = ['GRD_F_LT1', 'GRD_F_1_4'];
  const GTE5_M = ['GRD_M_5_14', 'GRD_M_15_24', 'GRD_M_25_44', 'GRD_M_45_64', 'GRD_M_65PLUS'];
  const GTE5_F = ['GRD_F_5_14', 'GRD_F_15_24', 'GRD_F_25_44', 'GRD_F_45_64', 'GRD_F_65PLUS'];
  const ALL_COCS = [...LT5_M, ...LT5_F, ...GTE5_M, ...GTE5_F];

  const synMapping = [];
  const addRows = (s, t, pairs) => pairs.forEach(([a,b]) => synMapping.push({ srcDeCode:s, srcCocCode:a, tgtDeCode:t, tgtCocCode:b }));
  ['SS_ARI', 'SS_GASTRO', 'SS_FEV_UNDIFF'].forEach(s => {
    addRows(s, SYN_DE_MAP[s], [...LT5_M,...LT5_F].map(x=>[x,COC.lt5]));
    addRows(s, SYN_DE_MAP[s], [...GTE5_M,...GTE5_F].map(x=>[x,COC.gte5]));
  });
  ['SS_FEV_HAEM', 'SS_FEV_NEURO'].forEach(s => addRows(s, SYN_DE_MAP[s], ALL_COCS.map(x=>[x,COC.unsp])));
  state.synMapping = synMapping;

  // ── Zero-fill: CARPHA cells that must show 0 (not blank) whenever GRD reported that week ──
  // Every mapped target, plus "Age unspecified" for the age-split syndromes (GRD has no unspecified band).
  const zeroFill = [...new Set(synMapping.map(r => r.tgtDeCode + '|' + r.tgtCocCode))];
  ['SS_ARI', 'SS_GASTRO', 'SS_FEV_UNDIFF'].forEach(s => zeroFill.push(SYN_DE_MAP[s] + '|' + COC.unsp));
  state.synZeroFill = [...new Set(zeroFill)].map(x => { const [de, coc] = x.split('|'); return { de, coc }; });

  // ── Sites mapping (priority order) ──
  // Each OU is bucketed into exactly ONE CARPHA category; first match wins.
  state.sitesMapping = [
    { carphaBucket: 'HOSP',  srcGroupCodes: ['HOSP'],
      expectedCode: 'SURV_SITES_HOSP_EXPECTED',  reportedCode: 'SURV_SITES_HOSP_REPORTED'  },
    { carphaBucket: 'PP',    srcGroupCodes: ['PROFF'],
      expectedCode: 'SURV_SITES_PP_EXPECTED',    reportedCode: 'SURV_SITES_PP_REPORTED'    },
    { carphaBucket: 'LAB',   srcGroupCodes: ['DX', 'MBL'],
      expectedCode: 'SURV_SITES_LAB_EXPECTED',   reportedCode: 'SURV_SITES_LAB_REPORTED'   },
    { carphaBucket: 'HC',    srcGroupCodes: ['COMM', 'OF'],
      expectedCode: 'SURV_SITES_HC_EXPECTED',    reportedCode: 'SURV_SITES_HC_REPORTED'    },
    { carphaBucket: 'OTHER', srcGroupCodes: ['PRISON', 'POE', 'RTF', 'SCHOOL', 'HOTEL', 'OTH'],
      expectedCode: 'SURV_SITES_OTHER_EXPECTED', reportedCode: 'SURV_SITES_OTHER_REPORTED' }
  ];

  console.log('Mapping loaded (codes + TEMP UID overrides): ' + synMapping.length + ' syndromic + 5 site buckets (HOSP/PP/LAB/HC/OTHER)');
  return state;
});