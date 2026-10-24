export const genId = (prefix = 'obj') =>
  `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
