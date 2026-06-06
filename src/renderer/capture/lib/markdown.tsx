import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

/**
 * Thin wrapper around the markdown renderer (swappable in one place). GFM gives tables /
 * strikethrough / task lists; remark-math + rehype-katex render LaTeX math (`$inline$`, `$$block$$`)
 * via KaTeX. HTML passthrough is intentionally OFF (no rehype-raw) so the model's output can't
 * inject markup. `throwOnError: false` keeps a malformed formula from blowing up the card.
 */
export function MarkdownView({ children }: { children: string }): JSX.Element {
  return (
    <Markdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
    >
      {children}
    </Markdown>
  )
}
