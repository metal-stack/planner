import { Fragment } from 'react'
import { CHANGE_ME, type AnsibleFile } from '../../derive/ansible'
import {
  iniTokens,
  inlineSpans,
  markdownBlocks,
  yamlTokens,
  type MdBlock,
  type Token,
  type TokenKind,
} from './syntax'

const TOKEN_CLASS: Record<TokenKind, string> = {
  plain: '',
  key: 'text-code-key',
  punct: 'text-code-comment',
  string: 'text-code-string',
  number: 'text-code-number',
  literal: 'text-code-literal',
  template: 'text-code-template',
  comment: 'text-code-comment italic',
  placeholder: 'rounded bg-brand-soft px-0.5 font-semibold text-ink',
}

function Lines({ lines }: { lines: Token[][] }) {
  return (
    <pre className="max-h-[70vh] overflow-auto px-4 py-3 font-mono text-xs leading-relaxed">
      {lines.map((line, i) => (
        <Fragment key={i}>
          {line.map((t, j) =>
            TOKEN_CLASS[t.kind] ? (
              <span key={j} className={TOKEN_CLASS[t.kind]}>
                {t.text}
              </span>
            ) : (
              <Fragment key={j}>{t.text}</Fragment>
            ),
          )}
          {'\n'}
        </Fragment>
      ))}
    </pre>
  )
}

/** Inline code and bold; CHANGE_ME stands out like in the YAML. */
function InlineText({ text }: { text: string }) {
  return (
    <>
      {inlineSpans(text).map((s, i) =>
        s.kind === 'code' ? (
          <code
            key={i}
            className={`rounded px-1 font-mono text-[0.85em] ${
              s.text === CHANGE_ME ? 'bg-brand-soft font-semibold' : 'bg-gray-100'
            }`}
          >
            {s.text}
          </code>
        ) : s.kind === 'strong' ? (
          <strong key={i}>{s.text}</strong>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        ),
      )}
    </>
  )
}

const HEADING_CLASS = [
  'text-lg font-semibold',
  'mt-2 text-base font-semibold',
  'text-sm font-semibold',
]

function Block({ block }: { block: MdBlock }) {
  switch (block.kind) {
    case 'heading': {
      const Tag = `h${Math.min(block.level + 1, 6)}` as 'h2'
      return (
        <Tag className={HEADING_CLASS[Math.min(block.level, 3) - 1]}>
          <InlineText text={block.text} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p>
          <InlineText text={block.text} />
        </p>
      )
    case 'list':
      return (
        <ul className="list-disc space-y-1 pl-5">
          {block.items.map((item, i) => (
            <li key={i}>
              <InlineText text={item} />
            </li>
          ))}
        </ul>
      )
    case 'code':
      return (
        <pre className="overflow-x-auto rounded-md bg-gray-50 px-3 py-2 font-mono text-xs leading-relaxed">
          {block.text}
        </pre>
      )
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-left">
                {block.header.map((h, i) => (
                  <th key={i} className="px-2 py-1.5 font-semibold text-gray-600">
                    <InlineText text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i} className="border-b border-gray-100 align-top">
                  {row.map((cell, j) => (
                    <td key={j} className="px-2 py-1 tabular-nums">
                      <InlineText text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="max-h-[70vh] space-y-3 overflow-auto px-5 py-4 text-sm leading-relaxed">
      {markdownBlocks(text).map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  )
}

const plainLines = (text: string): Token[][] =>
  text
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => [{ kind: 'plain', text: line }])

export type PreviewMode = 'rendered' | 'source'

/** A generated file, highlighted by type; markdown rendered or as source. */
export default function Preview({ file, mode }: { file: AnsibleFile; mode: PreviewMode }) {
  if (/\.md$/.test(file.path)) {
    return mode === 'rendered' ? (
      <Markdown text={file.content} />
    ) : (
      <Lines lines={plainLines(file.content)} />
    )
  }
  if (/\.ya?ml$/.test(file.path)) return <Lines lines={yamlTokens(file.content)} />
  if (/\.cfg$/.test(file.path)) return <Lines lines={iniTokens(file.content)} />
  return <Lines lines={plainLines(file.content)} />
}
