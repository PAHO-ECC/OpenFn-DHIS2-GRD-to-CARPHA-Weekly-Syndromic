fn(state => {
  const errors = [], warnings = [];
  state.carphaDataValues.forEach(dv => {
    const v = parseFloat(dv.value);
    if (v < 0)    errors.push('Negative: ' + dv.dataElement + '=' + v);
    if (v > 9999) warnings.push('High: ' + dv.dataElement + '=' + v);
  });
  if (errors.length) throw new Error('Validation failed:\n' + errors.join('\n'));
  console.log(warnings.length ? 'Warnings: ' + warnings.join(', ') : 'Validation passed.');
  const { data, ...rest } = state;
  return { ...rest, validationWarnings: warnings };
});