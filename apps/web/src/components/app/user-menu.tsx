"use client";

import * as React from "react";
import { LogOut, User as UserIcon, ChevronsUpDown, KeyRound, CircleHelp } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

const SESSION_KEY = "netpay.session";

export interface SessionUser {
  email: string;
  fullName?: string;
  role?: string;
  tenantSlug?: string;
}

function readSession(): SessionUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

export function UserMenu() {
  const router = useRouter();
  const [user, setUser] = React.useState<SessionUser | null>(null);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    setUser(readSession());
  }, []);

  const onLogout = React.useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // ignore: invalidamos cliente de todos modos
    }
    try {
      window.localStorage.removeItem(SESSION_KEY);
    } catch {
      /* noop */
    }
    toast.success("Sesión cerrada");
    router.push("/login");
  }, [router]);

  const initials = (user?.fullName || user?.email || "NP")
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" aria-label="Cuenta">
        <UserIcon className="h-4 w-4" />
      </Button>
    );
  }

  if (!user) {
    return (
      <Button asChild size="sm" className="h-9">
        <a href="/login">Entrar</a>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 gap-2 px-2 data-[state=open]:bg-accent"
          aria-label="Menú de cuenta"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {initials || "NP"}
          </span>
          <span className="hidden flex-col items-start leading-tight sm:flex">
            <span className="text-xs font-medium">{user.fullName || user.email}</span>
            <span className="text-[10px] text-muted-foreground">
              {user.role ?? "OWNER"}
              {user.tenantSlug ? ` · ${user.tenantSlug}` : ""}
            </span>
          </span>
          <ChevronsUpDown className="hidden h-3.5 w-3.5 text-muted-foreground sm:inline-block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col">
            <span className="text-sm font-medium">{user.fullName || "Sin nombre"}</span>
            <span className="truncate text-xs text-muted-foreground">{user.email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <KeyRound className="h-3.5 w-3.5" />
          <span>Cambiar contraseña</span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <CircleHelp className="h-3.5 w-3.5" />
          <span>Soporte</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout} className="text-destructive focus:text-destructive">
          <LogOut className="h-3.5 w-3.5" />
          <span>Cerrar sesión</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function useSession() {
  const [user, setUser] = React.useState<SessionUser | null>(null);
  React.useEffect(() => {
    setUser(readSession());
  }, []);
  return user;
}

export function writeSession(user: SessionUser) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(user));
}
