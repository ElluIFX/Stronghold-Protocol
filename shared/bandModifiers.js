/** Additional alive Touch holders each add 25% HP, ATK and DEF to the field's single medic. */
export function amedicStatMultiplier(bands) {
  const count = (Array.isArray(bands) ? bands : []).filter((id) => id === 'band_amedic').length;
  return count > 0 ? 1 + 0.25 * (count - 1) : 0;
}
