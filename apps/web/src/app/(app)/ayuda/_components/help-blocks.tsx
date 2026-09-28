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
              <p key={i} className="text-body text-foreground">
                {block.text}
              </p>
            );
          case "h3":
            return (
              <h3
                key={i}
                className="pt-3 font-display text-headline text-foreground"
              >
                {block.text}
              </h3>
            );
          case "list":
            return (
              <ul key={i} className="list-disc space-y-2 pl-5 text-body text-foreground marker:text-muted-foreground">
                {block.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ul>
            );
          case "steps":
            return (
              <ol key={i} className="space-y-2.5">
                {block.items.map((item, j) => (
                  <li key={j} className="flex gap-3 text-body text-foreground">
                    <span
                      aria-hidden
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-micro tabular-nums text-foreground"
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
              <pre key={i} className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-code-sm text-foreground">
                <code>{block.text}</code>
              </pre>
            );
          case "table":
            return (
              <div key={i} className="overflow-x-auto rounded-lg border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted text-micro-uppercase uppercase text-muted-foreground">
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
                                : "px-3 py-2.5 align-top text-foreground"
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
              <div key={i} className="divide-y overflow-hidden rounded-lg border">
                {block.items.map((item, j) => (
                  <details key={j} className="group bg-card">
                    <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3.5 text-body font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                      <span>{item.q}</span>
                      <ChevronDown
                        aria-hidden
                        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                      />
                    </summary>
                    <p className="px-4 pb-4 text-body text-foreground">{item.a}</p>
                  </details>
                ))}
              </div>
            );
          case "glossary":
            return (
              <dl key={i} className="divide-y overflow-hidden rounded-lg border">
                {block.items.map((item, j) => (
                  <div key={j} className="grid gap-1 bg-card px-4 py-3.5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
                    <dt className="text-body font-medium text-foreground">{item.term}</dt>
                    <dd className="text-body text-foreground">{item.definition}</dd>
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
