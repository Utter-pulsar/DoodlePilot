/**
 * Binary-search the largest font size in [min,max] at which `el` fits inside boxW×boxH — i.e. fill
 * the selection box, scaling the text up/down. If even `min` overflows the height, return `min`
 * plus the height the content actually needs at that size, so the caller can GROW the card (and add
 * an internal scroll only as a last resort) rather than shrink the text into illegibility.
 *
 * `el` must already be laid out at width `boxW` (fixed width → correct wrapping); only its
 * font-size is varied here. The probe mutates `el.style.fontSize`, settling on the chosen value.
 */
export function fitFontSize(
  el: HTMLElement,
  boxW: number,
  boxH: number,
  min: number,
  max: number
): { fontSize: number; neededHeight: number } {
  const fits = (size: number): boolean => {
    el.style.fontSize = `${size}px`
    return el.scrollHeight <= boxH && el.scrollWidth <= boxW + 1
  }
  if (!fits(min)) {
    el.style.fontSize = `${min}px`
    return { fontSize: min, neededHeight: el.scrollHeight }
  }
  let lo = min
  let hi = max
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2) // ceil → converges upward, no infinite loop
    if (fits(mid)) lo = mid
    else hi = mid - 1
  }
  el.style.fontSize = `${lo}px`
  return { fontSize: lo, neededHeight: el.scrollHeight }
}
