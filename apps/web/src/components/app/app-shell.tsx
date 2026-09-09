"use client";

import * as React from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Brand, SidebarNav } from "./sidebar-nav";
import { Topbar } from "./topbar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-screen bg-background">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-1.5 focus:text-sm focus:shadow"
        >
          Saltar al contenido
        </a>

        <aside
          className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r bg-background lg:flex lg:flex-col"
          aria-label="Navegación principal"
        >
          <Brand className="border-b" />
          <SidebarNav />
          <div className="mt-auto border-t p-3 text-[11px] leading-relaxed text-muted-foreground">
            PAYMENT_PROVIDER=DUMMY
            <br />
            livemode=false · V2
          </div>
        </aside>

        <div className="lg:pl-64">
          <Topbar onMobileNav={() => {}} />
          <main id="main" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
