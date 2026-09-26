import { Info, CheckCircle2, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { HelpBlock } from "../_content/types";

const CALLOUT_ICON = { info: Info, success: CheckCircle2, warning: AlertTriangle } as const;
const CALLOUT_VARIANT = { info: "info", success: "success", warning: "warning" } as const;

/** Convierte el mini-lenguaje de bloques del contenido de ayuda en JSX, con los mismos componentes visuales del resto del panel. */
export function HelpBlocks({ blocks }: { blocks: HelpBlock[] }) {
  return (
    <div className="space-y-4">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "p":
            return (
              <p key={i} className="text-sm leading-relaxed text-foreground/90">
                {block.text}
              </p>
            );
          case "h3":
            return (
              <h3 key={i} className="font-display text-sm font-semibold tracking-tight">
                {block.text}
              </h3>
            );
          case "list":
            return (
              <ul key={i} className="list-disc space-y-1.5 pl-5 text-sm text-foreground/90">
                {block.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ul>
            );
          case "steps":
            return (
              <ol key={i} className="list-decimal space-y-1.5 pl-5 text-sm text-foreground/90">
                {block.items.map((item, j) => (
                  <li key={j}>{item}</li>
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
              <pre key={i} className="overflow-x-auto rounded-md border bg-muted p-3 text-xs">
                <code>{block.text}</code>
              </pre>
            );
          case "table":
            return (
              <div key={i} className="overflow-x-auto rounded-md border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      {block.headers.map((h, j) => (
                        <th key={j} className="px-3 py-2 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, j) => (
                      <tr key={j} className="border-t">
                        {row.map((cell, k) => (
                          <td key={k} className="px-3 py-2 align-top text-foreground/90">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
