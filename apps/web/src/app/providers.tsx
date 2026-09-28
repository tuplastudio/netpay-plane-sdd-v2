"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { useState } from "react";
import { ThemeProvider, useTheme } from "@/components/theme-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: (failureCount, error) => {
              const status = (error as { status?: number })?.status;
              if (status && status >= 400 && status < 500) return false;
              return failureCount < 2;
            },
          },
        },
      }),
  );
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        {children}
        <ThemedToaster />
      </QueryClientProvider>
    </ThemeProvider>
  );
}

function ThemedToaster() {
  const { resolved } = useTheme();
  return <Toaster theme={resolved} richColors position="top-right" />;
}