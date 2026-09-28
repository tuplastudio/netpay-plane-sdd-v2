import type { ReactNode } from "react";

// El agente escribe texto plano de WhatsApp: *negrita*, saltos de línea y enlaces.
const TOKEN = /(\*[^*\n]+\*|https?:\/\/[^\s)]+)/g;

export function formatInline(line: string): ReactNode[] {
  return line.split(TOKEN).map((part, i) => {
    if (/^\*[^*\n]+\*$/.test(part)) return <strong key={i}>{part.slice(1, -1)}</strong>;
    if (/^https?:\/\//.test(part))
      return (
        <a key={i} href={part} target="_blank" rel="noreferrer">
          {part}
        </a>
      );
    return part;
  });
}

export function FormattedText({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/);
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i}>
          {p.split("\n").map((line, j, arr) => (
            <span key={j}>
              {formatInline(line)}
              {j < arr.length - 1 && <br />}
            </span>
          ))}
        </p>
      ))}
    </>
  );
}
