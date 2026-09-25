"use client";

import * as React from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

function SellLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <rect width="36" height="36" rx="8" fill="currentColor" className="text-primary" />
      <path
        d="M9 12h2.5l2.3 9.5h11l2-6H13l-.5-2H10l-.5-2H9z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        className="text-primary-foreground"
        fill="none"
      />
      <circle
        cx="16"
        cy="26.5"
        r="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-primary-foreground"
        fill="none"
      />
      <circle
        cx="24"
        cy="26.5"
        r="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-primary-foreground"
        fill="none"
      />
      <path
        d="M18 9a4 4 0 0 1 4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        className="text-primary-foreground"
        fill="none"
      />
    </svg>
  );
}

export function AuthBrand({ className }: { className?: string }) {
  return (
    <Link
      href="/login"
      aria-label="Atiende ya — ir a iniciar sesión"
      className={cn(
        "flex w-fit items-center gap-2.5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2",
        className,
      )}
    >
      <SellLogo className="h-8 w-8" />
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-semibold">Atiende ya</span>
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Portal operativo
        </span>
      </span>
    </Link>
  );
}

export function AuthError({
  message,
  title = "No se pudo continuar",
}: {
  message?: string | null;
  title?: string;
}) {
  if (!message) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertCircle aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export function authErrorMessage(
  err: unknown,
  fallback: string,
  byStatus: Record<number, string> = {},
): string {
  const status = (err as { response?: { status?: number } })?.response?.status;
  if (typeof status === "number" && byStatus[status]) return byStatus[status];
  return fallback;
}
