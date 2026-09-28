import { Info, CheckCircle2, AlertTriangle, ChevronDown } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { HelpBlock } from "../_content/types";

const CALLOUT_ICON = { info: Info, success: CheckCircle2, warning: AlertTriangle } as const;
const CALLOUT_VARIANT = { info: "info", success: "success", warning: "warning" } as const;

/** Convierte el mini-lenguaje de bloques del contenido de ayuda en JSX, con los mismos componentes visuales del resto del panel. */
export function HelpBlocks({ blocks }: { blocks: HelpBlock[] }) {
  return (
    <div className="space-y-5">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "p":
            return (
              <p key={i} className="text-[15px] leading-[1.6] text-foreground/90">
                {block.text}
              </p>
            );
          case "h3":
            return (
              <h3
                key={i}
                className="pt-3 font-display text-[1.25rem] font-medium leading-tight tracking-[-0.03em] text-foreground"
              >
                {block.text}
              </h3>
            );
          case "list":
            return (
              <ul key={i} className="list-disc space-y-2 pl-5 text-[15px] leading-[1.55] text-foreground/90 marker:text-muted-foreground">
                {block.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ul>
            );
          case "steps":
            return (
              <ol key={i} className="space-y-2.5">
                {block.items.map((item, j) => (
                  <li key={j} className="flex gap-3 text-[15px] leading-[1.55] text-foreground/90">
                    <span
                      aria-hidden
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums text-foreground"
                    >
                      {j + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="sr-only">Paso {j + 1}: </span>
                      {item}
                    </span>
                  </li>
                ))}
              </ol>
            );
          case "callout": {
            const Icon = CALLOUT_ICON[block.tone];
            return (
              <Alert key={i} variant={CALLOUT_VARIANT[block.tone]}>
                <Icon aria-hidden />
                {block.title ? <AlertTitle>{block.title}</AlertTitle> : null}
                <AlertDescription>{block.text}</AlertDescription>
              </Alert>
            );
          }
          case "code":
            return (
              <pre key={i} className="overflow-x-auto rounded-[10px] border bg-muted p-3 text-xs">
                <code>{block.text}</code>
              </pre>
            );
          case "table":
            return (
              <div key={i} className="overflow-x-auto rounded-[15px] border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      {block.headers.map((h, j) => (
                        <th key={j} scope="col" className="px-3 py-2.5 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, j) => (
                      <tr key={j} className="border-t">
                        {row.map((cell, k) => (
                          <td
                            key={k}
                            className={
                              k === 0
                                ? "px-3 py-2.5 align-top font-medium text-foreground"
                                : "px-3 py-2.5 align-top text-foreground/90"
                            }
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "faq":
            return (
              <div key={i} className="divide-y overflow-hidden rounded-[15px] border">
                {block.items.map((item, j) => (
                  <details key={j} className="group bg-card">
                    <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3.5 text-[15px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                      <span>{item.q}</span>
                      <ChevronDown
                        aria-hidden
                        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                      />
                    </summary>
                    <p className="px-4 pb-4 text-[15px] leading-[1.6] text-foreground/90">{item.a}</p>
                  </details>
                ))}
              </div>
            );
          case "glossary":
            return (
              <dl key={i} className="divide-y overflow-hidden rounded-[15px] border">
                {block.items.map((item, j) => (
                  <div key={j} className="grid gap-1 bg-card px-4 py-3.5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
                    <dt className="text-[15px] font-medium text-foreground">{item.term}</dt>
                    <dd className="text-[15px] leading-[1.55] text-foreground/90">{item.definition}</dd>
                  </div>
                ))}
              </dl>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
