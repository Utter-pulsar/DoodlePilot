import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

// Internal placeholder sentinels. A NUL char never appears in model markdown and carries no $ / \ /
// { } / backtick, so none of the math passes below touch it — and it can't collide with real text
// like " D3 " (e.g. 维生素 D3). Always restored before rendering, so Markdown never sees a NUL.
const NUL = String.fromCharCode(0)
const mark = (kind: string, i: number): string => `${NUL}${kind}${i}${NUL}`
const restore = (s: string, kind: string, parts: string[]): string =>
  s.replace(new RegExp(`${NUL}${kind}(\\d+)${NUL}`, 'g'), (_m, i: string) => parts[Number(i)] ?? '')

/** `\tag{N}` is DISPLAY-only in KaTeX: in inline `$…$` (how many vision models emit equations) it
 *  throws, and rehype-katex then prints the whole formula as RED source. Rewrite it to a trailing
 *  "(N)" that renders in any mode. The brace pattern tolerates ONE level of nesting (e.g.
 *  `\tag{\text{eq 1}}`) so a tag with a command inside doesn't break. Called ONLY on math spans. */
function rewriteTag(math: string): string {
  return math.replace(
    /\\tag\*?\{((?:[^{}]|\{[^{}]*\})*)\}/g,
    (_m, body: string) => `\\quad\\text{(${body})}`
  )
}

/**
 * Make the model's math reliably KaTeX-renderable, WITHOUT touching prose or code:
 *  1. protect fenced + inline code (so `$$` / `\tag` inside code is never rewritten or miscounted)
 *  2. normalize LaTeX delimiters `\[ \]` → `$$ $$` and `\( \)` → `$ $` (remark-math only knows $ / $$)
 *  3. rewrite `\tag` ONLY inside real math spans (display first, then inline) — never in prose
 *  4. while STREAMING, drop a still-open display formula (a leftover `$$` with no close, which after
 *     pulling out the complete pairs can ONLY be unclosed) so it doesn't flash as literal "$$…"
 */
function prepareMath(src: string, streaming: boolean): string {
  const code: string[] = []
  let s = src.replace(/```[\s\S]*?```|`[^`\n]*`/g, (m) => {
    code.push(m)
    return mark('C', code.length - 1)
  })

  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_m, b: string) => `\n$$${b}$$\n`)
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, (_m, b: string) => `$${b}$`)

  // pull out COMPLETE display math (rewriting its \tag), so any `$$` still left in `s` afterwards is
  // necessarily an UNCLOSED opener, and the inline pass below can't see `$$` either.
  const disp: string[] = []
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_m, b: string) => {
    disp.push(`$$${rewriteTag(b)}$$`)
    return mark('D', disp.length - 1)
  })
  s = s.replace(/\$([^\n$]*?)\$/g, (_m, b: string) => `$${rewriteTag(b)}$`)

  if (streaming) {
    const open = s.lastIndexOf('$$') // a complete pair is a placeholder, so a leftover $$ is unclosed
    if (open !== -1) s = s.slice(0, open)
  }

  s = restore(s, 'D', disp)
  s = restore(s, 'C', code)
  return s
}

/**
 * Thin wrapper around the markdown renderer (swappable in one place). GFM gives tables /
 * strikethrough / task lists; remark-math + rehype-katex render LaTeX math (`$inline$`, `$$block$$`)
 * via KaTeX. HTML passthrough is intentionally OFF (no rehype-raw) so the model's output can't
 * inject markup. `throwOnError: false` keeps a malformed formula from blowing up the card.
 */
export function MarkdownView({
  children,
  streaming = false
}: {
  children: string
  streaming?: boolean
}): JSX.Element {
  return (
    <Markdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
    >
      {prepareMath(children, streaming)}
    </Markdown>
  )
}
