// Validator for the JSON Schema subset used by report.schema.json:
// type (incl. integer), required, properties, additionalProperties: false,
// enum, items, maxLength, minimum, maximum.
function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value, type) {
  const types = Array.isArray(type) ? type : [type];
  const actual = typeOf(value);
  return types.some((t) => t === actual || (t === 'number' && actual === 'integer'));
}

export function validate(schema, value, path = '$') {
  const errors = [];
  if (schema.type && !matchesType(value, schema.type)) {
    return [`${path}: expected ${[].concat(schema.type).join('|')}, got ${typeOf(value)}`];
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: must be one of ${schema.enum.join(', ')}`);
  if (typeof value === 'string' && schema.maxLength !== undefined && value.length > schema.maxLength) {
    errors.push(`${path}: longer than ${schema.maxLength} characters`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above maximum ${schema.maximum}`);
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => errors.push(...validate(schema.items, item, `${path}[${i}]`)));
  }
  if (typeOf(value) === 'object') {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${path}.${key}: is required`);
    for (const [key, child] of Object.entries(value)) {
      if (schema.properties?.[key]) errors.push(...validate(schema.properties[key], child, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: is not allowed`);
    }
  }
  return errors;
}
